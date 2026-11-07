import {
  BinaryExpression,
  CallExpression,
  ElementAccessExpression,
  ForStatement,
  FunctionDeclaration,
  IdentifierExpression,
  IntegerLiteralExpression,
  Node,
  PropertyAccessExpression,
  StringLiteralExpression,
  UnaryPostfixExpression,
  UnaryPrefixExpression,
  VariableDeclaration,
  VariableStatement,
} from "assemblyscript/dist/assemblyscript.js";
import { i32Type, identifier, integer, viewType } from "./ast.js";
import { operationSemantics } from "./operations.js";
import { expressionRepresentation } from "./rewrite.js";
import {
  isDeclarationIdentifier,
  isStrStaticCall,
  propertyCall,
  walk,
} from "./visitor.js";
const ASSIGNMENTS = new Set([
  101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113,
]);
function splitArray(expression, context, signatures) {
  if (!(expression instanceof CallExpression) || isStrStaticCall(expression))
    return null;
  const property = propertyCall(expression);
  const separator = expression.args[0];
  const receiver = property?.expression;
  if (
    property?.property.text !== "split" ||
    expression.args.length !== 1 ||
    expression.typeArguments?.length ||
    !(separator instanceof StringLiteralExpression) ||
    !separator.value.length ||
    !(
      receiver instanceof IdentifierExpression ||
      receiver instanceof StringLiteralExpression
    )
  )
    return null;
  const representation = expressionRepresentation(
    receiver,
    context,
    signatures,
  );
  return representation === "native" || representation === "view"
    ? { receiver, separator }
    : null;
}
function copy(split, range) {
  return {
    receiver:
      split.receiver instanceof IdentifierExpression
        ? identifier(split.receiver.text, range)
        : Node.createStringLiteralExpression(split.receiver.value, range),
    separator: Node.createStringLiteralExpression(split.separator.value, range),
  };
}
function splitCall(split, range) {
  const { receiver, separator } = copy(split, range);
  return Node.createCallExpression(
    Node.createPropertyAccessExpression(
      receiver,
      identifier("split", range),
      range,
    ),
    null,
    [separator],
    range,
  );
}
function sourceText(node) {
  return node.range.source.text.substring(node.range.start, node.range.end);
}
function splitLoop(loop, array, context) {
  const initializer = loop.initializer;
  if (
    !(initializer instanceof VariableStatement) ||
    initializer.declarations.length !== 1
  )
    return null;
  const counter = initializer.declarations[0];
  const index = counter.name.text;
  const condition = loop.condition;
  const step = loop.incrementor;
  if (
    !counter.initializer ||
    sourceText(counter.initializer) !== "0" ||
    context.duplicateNames.has(index) ||
    !(condition instanceof BinaryExpression) ||
    condition.operator !== 72 ||
    !(condition.left instanceof IdentifierExpression) ||
    condition.left.text !== index ||
    !(condition.right instanceof PropertyAccessExpression) ||
    condition.right.property.text !== "length" ||
    !(condition.right.expression instanceof IdentifierExpression) ||
    context.classes.declarationOf(condition.right.expression, context) !==
      array ||
    !(
      ((step instanceof UnaryPostfixExpression ||
        step instanceof UnaryPrefixExpression) &&
        step.operator === 87 &&
        step.operand instanceof IdentifierExpression &&
        step.operand.text === index) ||
      (step instanceof BinaryExpression &&
        step.operator === 102 &&
        step.left instanceof IdentifierExpression &&
        step.left.text === index &&
        sourceText(step.right) === "1")
    )
  )
    return null;
  const accesses = new Set();
  const parents = new Map();
  let written = false;
  walk(loop.body, (node, ref) => {
    if (ref.parent) parents.set(node, ref.parent);
    if (node instanceof FunctionDeclaration) return false;
    if (!(node instanceof IdentifierExpression) || node.text !== index) return;
    const parent = ref.parent;
    if (
      (parent instanceof BinaryExpression &&
        parent.left === node &&
        ASSIGNMENTS.has(parent.operator)) ||
      ((parent instanceof UnaryPrefixExpression ||
        parent instanceof UnaryPostfixExpression) &&
        (parent.operator === 87 || parent.operator === 88))
    )
      written = true;
    if (
      parent instanceof ElementAccessExpression &&
      ref.key === "elementExpression" &&
      parent.expression instanceof IdentifierExpression &&
      context.classes.declarationOf(parent.expression, context) === array
    )
      accesses.add(parent);
  });
  if (written) return null;
  for (const access of accesses) {
    let top = access;
    for (
      let parent = parents.get(top);
      parent instanceof PropertyAccessExpression &&
      parent.expression === top &&
      operationSemantics(parent.property.text).spanProducing;
      parent = parents.get(top)
    ) {
      const call = parents.get(parent);
      if (!(call instanceof CallExpression) || call.expression !== parent)
        break;
      top = call;
    }
    const parent = parents.get(top);
    const consumed =
      (parent instanceof VariableDeclaration && parent.initializer === top) ||
      (parent instanceof PropertyAccessExpression &&
        parent.expression === top &&
        (parent.property.text === "length" ||
          (operationSemantics(parent.property.text).spanScalar &&
            parents.get(parent) instanceof CallExpression))) ||
      (parent instanceof BinaryExpression &&
        parent.left === top &&
        (parent.operator === 76 ||
          parent.operator === 77 ||
          parent.operator === 78 ||
          parent.operator === 79));
    if (!consumed) return null;
  }
  return { loop, index, accesses };
}
export function normalizeSplitArrays(
  declaration,
  context,
  signatures,
  isStable,
) {
  const body = declaration.body;
  if (!body || context.representationSensitive) return false;
  const candidates = new Map();
  for (const binding of context.bindings.values()) {
    const local = binding.declaration;
    if (
      context.duplicateNames.has(binding.name) ||
      local.decorators?.length ||
      local.type
    )
      continue;
    const split = splitArray(local.initializer, context, signatures);
    if (split && isStable(binding.name)) candidates.set(local, split);
  }
  if (!candidates.size) return false;
  const loops = new Map();
  walk(body, (node) => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (!(node instanceof ForStatement)) return;
    for (const array of candidates.keys()) {
      const loop = splitLoop(node, array, context);
      if (loop) loops.set(array, [...(loops.get(array) ?? []), loop]);
    }
  });
  const loopAccess = (array, access) =>
    (loops.get(array) ?? []).some((loop) => loop.accesses.has(access));
  walk(body, (node, ref) => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (
      !(node instanceof IdentifierExpression) ||
      isDeclarationIdentifier(node, ref)
    )
      return;
    const local = context.classes.declarationOf(node, context);
    if (!local || !candidates.has(local)) return;
    const parent = ref.parent;
    const grandparent = ref.grandparent;
    const written =
      (grandparent instanceof BinaryExpression &&
        grandparent.left === parent &&
        ASSIGNMENTS.has(grandparent.operator)) ||
      ((grandparent instanceof UnaryPrefixExpression ||
        grandparent instanceof UnaryPostfixExpression) &&
        (grandparent.operator === 87 || grandparent.operator === 88));
    if (
      !written &&
      ((parent instanceof PropertyAccessExpression &&
        ref.key === "expression" &&
        parent.property.text === "length") ||
        (parent instanceof ElementAccessExpression &&
          ref.key === "expression" &&
          (parent.elementExpression instanceof IntegerLiteralExpression ||
            loopAccess(local, parent))))
    )
      return;
    candidates.delete(local);
  });
  if (!candidates.size) return false;
  let snapshots = 0;
  walk(body, (node) => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (!(node instanceof VariableStatement)) return;
    const declarations = [];
    for (const local of node.declarations) {
      const split = candidates.get(local);
      if (split && split.receiver instanceof IdentifierExpression) {
        const view =
          expressionRepresentation(split.receiver, context, signatures) ===
          "view";
        if (view || !isStable(split.receiver.text)) {
          const receiver = split.receiver;
          let name = `__as_str_split_owner_${snapshots++}`;
          while (body.range.source.text.includes(name)) name += "_";
          const snapshot = view
            ? Node.createCallExpression(
                Node.createPropertyAccessExpression(
                  receiver,
                  identifier("slice", receiver.range),
                  receiver.range,
                ),
                null,
                [integer(0, receiver)],
                receiver.range,
              )
            : receiver;
          declarations.push(
            Node.createVariableDeclaration(
              identifier(name, local.range),
              null,
              8,
              view ? viewType(local.range) : null,
              snapshot,
              local.range,
            ),
          );
          split.receiver = identifier(name, receiver.range);
          local.initializer = splitCall(split, local.initializer.range);
        }
      }
      declarations.push(local);
    }
    node.declarations = declarations;
  });
  const cursors = new Map();
  let declared = snapshots > 0;
  for (const [array, split] of candidates) {
    for (const { loop, accesses } of loops.get(array) ?? []) {
      if (!accesses.size) continue;
      const counter = loop.initializer.declarations[0];
      const range = counter.range;
      const stepRange = loop.incrementor.range;
      let name = `__as_str_field_${cursors.size}`;
      while (
        range.source.text.includes(name) ||
        context.bindings.has(name) ||
        context.parameters.has(name)
      )
        name += "_";
      const cursor = () => identifier(name, stepRange);
      const { receiver } = copy(split, range);
      loop.initializer.declarations.push(
        Node.createVariableDeclaration(
          identifier(name, range),
          null,
          16,
          null,
          Node.createCallExpression(
            Node.createPropertyAccessExpression(
              receiver,
              identifier("slice", range),
              range,
            ),
            null,
            [integer(0, receiver)],
            range,
          ),
          range,
        ),
      );
      const advance = Node.createBinaryExpression(
        101,
        cursor(),
        Node.createCallExpression(
          Node.createPropertyAccessExpression(
            cursor(),
            identifier("slice", stepRange),
            stepRange,
          ),
          null,
          [
            Node.createBinaryExpression(
              81,
              Node.createCallExpression(
                Node.createPropertyAccessExpression(
                  cursor(),
                  identifier("indexOf", stepRange),
                  stepRange,
                ),
                null,
                [
                  Node.createStringLiteralExpression(
                    split.separator.value,
                    stepRange,
                  ),
                ],
                stepRange,
              ),
              integer(split.separator.value.length, receiver),
              stepRange,
            ),
          ],
          stepRange,
        ),
        stepRange,
      );
      loop.incrementor = Node.createCommaExpression(
        [advance, loop.incrementor],
        stepRange,
      );
      for (const access of accesses) cursors.set(access, name);
      declared = true;
    }
  }
  const scalar = (expression) => {
    if (!(expression instanceof IdentifierExpression)) return null;
    const local = context.classes.declarationOf(expression, context);
    return local ? (candidates.get(local) ?? null) : null;
  };
  walk(body, (node) => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (node instanceof VariableDeclaration && candidates.has(node)) {
      node.initializer = Node.createPropertyAccessExpression(
        node.initializer,
        identifier("length", node.range),
        node.range,
      );
      node.type = i32Type(node.range);
      return;
    }
    const record = node;
    for (const key of Object.keys(record)) {
      const value = record[key];
      const replace = (child) => {
        if (
          child instanceof PropertyAccessExpression &&
          child.property.text === "length" &&
          scalar(child.expression)
        )
          return child.expression;
        if (
          child instanceof ElementAccessExpression &&
          scalar(child.expression)
        ) {
          const split = scalar(child.expression);
          const cursor = cursors.get(child);
          if (cursor)
            return Node.createElementAccessExpression(
              splitCall(
                {
                  receiver: identifier(cursor, child.range),
                  separator: split.separator,
                },
                child.range,
              ),
              integer(0, child),
              child.range,
            );
          return Node.createElementAccessExpression(
            splitCall(split, child.range),
            child.elementExpression,
            child.range,
          );
        }
        return child;
      };
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) value[i] = replace(value[i]);
      } else if (value instanceof Node) {
        record[key] = replace(value);
      }
    }
  });
  return declared ? "declared" : "changed";
}
