import {
  BinaryExpression,
  CallExpression,
  CommonFlags,
  ElementAccessExpression,
  Expression,
  ForStatement,
  FunctionDeclaration,
  IdentifierExpression,
  IntegerLiteralExpression,
  Node,
  PropertyAccessExpression,
  StringLiteralExpression,
  Token,
  UnaryPostfixExpression,
  UnaryPrefixExpression,
  VariableDeclaration,
  VariableStatement,
} from "assemblyscript/dist/assemblyscript.js";
import { i32Type, identifier, integer } from "./ast.js";
import { FunctionContext } from "./model.js";
import { operationSemantics } from "./operations.js";
import { expressionRepresentation } from "./rewrite.js";
import { FunctionSignatures } from "./signatures.js";
import {
  isDeclarationIdentifier,
  isStrStaticCall,
  propertyCall,
  walk,
} from "./visitor.js";

const ASSIGNMENTS = new Set([
  Token.Equals,
  Token.Plus_Equals,
  Token.Minus_Equals,
  Token.Asterisk_Equals,
  Token.Asterisk_Asterisk_Equals,
  Token.Slash_Equals,
  Token.Percent_Equals,
  Token.LessThan_LessThan_Equals,
  Token.GreaterThan_GreaterThan_Equals,
  Token.GreaterThan_GreaterThan_GreaterThan_Equals,
  Token.Ampersand_Equals,
  Token.Bar_Equals,
  Token.Caret_Equals,
]);

interface SplitArray {
  receiver: IdentifierExpression | StringLiteralExpression;
  separator: StringLiteralExpression;
}

/** `receiver.split("sep")` with a non-empty literal separator. */
function splitArray(
  expression: Expression | null,
  context: FunctionContext,
  signatures: FunctionSignatures,
): SplitArray | null {
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

function copy(
  split: SplitArray,
  range: Expression["range"],
): { receiver: Expression; separator: Expression } {
  return {
    receiver:
      split.receiver instanceof IdentifierExpression
        ? identifier(split.receiver.text, range)
        : Node.createStringLiteralExpression(split.receiver.value, range),
    separator: Node.createStringLiteralExpression(split.separator.value, range),
  };
}

function splitCall(split: SplitArray, range: Expression["range"]): Expression {
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

interface SplitLoop {
  loop: ForStatement;
  index: string;
  accesses: Set<ElementAccessExpression>;
}

function sourceText(node: Node): string {
  return node.range.source.text.substring(node.range.start, node.range.end);
}

/**
 * `for (let i = 0; i < parts.length; i++)` whose body never writes `i`: each
 * iteration reads the next field, so a cursor can replace random access.
 */
function splitLoop(
  loop: ForStatement,
  array: VariableDeclaration,
  context: FunctionContext,
): SplitLoop | null {
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
    condition.operator !== Token.LessThan ||
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
        step.operator === Token.Plus_Plus &&
        step.operand instanceof IdentifierExpression &&
        step.operand.text === index) ||
      (step instanceof BinaryExpression &&
        step.operator === Token.Plus_Equals &&
        step.left instanceof IdentifierExpression &&
        step.left.text === index &&
        sourceText(step.right) === "1")
    )
  )
    return null;
  const accesses = new Set<ElementAccessExpression>();
  const parents = new Map<Node, Node>();
  let written = false;
  walk(loop.body, (node, ref): boolean | void => {
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
        (parent.operator === Token.Plus_Plus ||
          parent.operator === Token.Minus_Minus))
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
  // A cursor must pack, so every field must end where a packed span lowers.
  for (const access of accesses) {
    let top: Node = access;
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
        (parent.operator === Token.Equals_Equals ||
          parent.operator === Token.Exclamation_Equals ||
          parent.operator === Token.Equals_Equals_Equals ||
          parent.operator === Token.Exclamation_Equals_Equals));
    if (!consumed) return null;
  }
  return { loop, index, accesses };
}

/**
 * A split array read only through its length and constant indexes is never
 * needed as an array: its length counts separators and each field is a span
 * of the receiver. A forward loop over every field reads them through a
 * cursor; other variable indexes would rescan the receiver per access, so
 * they keep the native array.
 */
export function normalizeSplitArrays(
  declaration: FunctionDeclaration,
  context: FunctionContext,
  signatures: FunctionSignatures,
  isStable: (name: string) => boolean,
): "changed" | "declared" | false {
  const body = declaration.body;
  if (!body || context.representationSensitive) return false;
  const candidates = new Map<VariableDeclaration, SplitArray>();
  for (const binding of context.bindings.values()) {
    const local = binding.declaration;
    if (
      context.duplicateNames.has(binding.name) ||
      local.decorators?.length ||
      local.type
    )
      continue;
    const split = splitArray(local.initializer, context, signatures);
    if (
      split &&
      isStable(binding.name) &&
      (split.receiver instanceof StringLiteralExpression ||
        isStable(split.receiver.text))
    )
      candidates.set(local, split);
  }
  if (!candidates.size) return false;
  const loops = new Map<VariableDeclaration, SplitLoop[]>();
  walk(body, (node): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (!(node instanceof ForStatement)) return;
    for (const array of candidates.keys()) {
      const loop = splitLoop(node, array, context);
      if (loop) loops.set(array, [...(loops.get(array) ?? []), loop]);
    }
  });
  const loopAccess = (
    array: VariableDeclaration,
    access: ElementAccessExpression,
  ): boolean =>
    (loops.get(array) ?? []).some((loop) => loop.accesses.has(access));
  walk(body, (node, ref): boolean | void => {
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
    // Neither form may be written: a field or length assignment mutates.
    const written =
      (grandparent instanceof BinaryExpression &&
        grandparent.left === parent &&
        ASSIGNMENTS.has(grandparent.operator)) ||
      ((grandparent instanceof UnaryPrefixExpression ||
        grandparent instanceof UnaryPostfixExpression) &&
        (grandparent.operator === Token.Plus_Plus ||
          grandparent.operator === Token.Minus_Minus));
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

  // Each loop reads its fields through a cursor declared beside its counter.
  const cursors = new Map<ElementAccessExpression, string>();
  let declared = false;
  for (const [array, split] of candidates) {
    for (const { loop, accesses } of loops.get(array) ?? []) {
      if (!accesses.size) continue;
      // Scope resolution is positional: declare the cursor where the counter
      // is declared, and read it where the incrementor reads.
      const counter = (loop.initializer as VariableStatement).declarations[0];
      const range = counter.range;
      const stepRange = loop.incrementor!.range;
      let name = `__as_str_field_${cursors.size}`;
      while (
        range.source.text.includes(name) ||
        context.bindings.has(name) ||
        context.parameters.has(name)
      )
        name += "_";
      const cursor = (): IdentifierExpression => identifier(name, stepRange);
      const { receiver } = copy(split, range);
      (loop.initializer as VariableStatement).declarations.push(
        Node.createVariableDeclaration(
          identifier(name, range),
          null,
          CommonFlags.Let,
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
      // Step past one separator. After the last field the loop exits.
      const advance = Node.createBinaryExpression(
        Token.Equals,
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
              Token.Plus,
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
        [advance, loop.incrementor!],
        stepRange,
      );
      for (const access of accesses) cursors.set(access, name);
      declared = true;
    }
  }

  const scalar = (expression: Expression): SplitArray | null => {
    if (!(expression instanceof IdentifierExpression)) return null;
    const local = context.classes.declarationOf(expression, context);
    return local ? (candidates.get(local) ?? null) : null;
  };
  walk(body, (node): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (node instanceof VariableDeclaration && candidates.has(node)) {
      node.initializer = Node.createPropertyAccessExpression(
        node.initializer!,
        identifier("length", node.range),
        node.range,
      );
      node.type = i32Type(node.range);
      return;
    }
    // Replace children in place; the walk snapshots them before descending.
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      const replace = (child: unknown): unknown => {
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
          const split = scalar(child.expression)!;
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
