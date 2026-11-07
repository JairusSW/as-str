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
import {
  i32Type,
  identifier,
  integer,
  viewType,
  retainedViewSnapshots,
} from "./ast.js";
import { isSpanLink, spanChainRoot } from "./packed-span.js";
import { FunctionContext } from "./model.js";
import { operationSemantics } from "./operations.js";
import { expressionRepresentation } from "./rewrite.js";
import { FunctionSignatures } from "./signatures.js";
import {
  isDeclarationIdentifier,
  isStrStaticCall,
  propertyCall,
  walk,
  writeTarget,
} from "./visitor.js";

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
  return representation === "native" ||
    representation === "view" ||
    spanOfNative(receiver, context, signatures, 0)
    ? { receiver, separator }
    : null;
}

/** A local initialized by a span chain whose root is a native string. */
export function spanOfNative(
  expression: Expression,
  context: FunctionContext,
  signatures: FunctionSignatures,
  depth: number,
): boolean {
  if (!(expression instanceof IdentifierExpression) || depth > 8) return false;
  const initializer = context.classes.bindingOf(expression, context)
    ?.declaration.initializer;
  if (!initializer || !isSpanLink(initializer)) return false;
  const root = spanChainRoot(initializer);
  return (
    root instanceof StringLiteralExpression ||
    expressionRepresentation(root, context, signatures) === "native" ||
    spanOfNative(root, context, signatures, depth + 1)
  );
}

/** `rows[r]` where `rows` holds the split of a native string. */
function nativeSplitElement(
  expression: Expression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): boolean {
  if (
    !(expression instanceof ElementAccessExpression) ||
    !(expression.expression instanceof IdentifierExpression)
  )
    return false;
  const split = context.classes.bindingOf(expression.expression, context)
    ?.declaration.initializer;
  if (!(split instanceof CallExpression) || isStrStaticCall(split))
    return false;
  const property = propertyCall(split);
  return (
    property?.property.text === "split" &&
    expressionRepresentation(property.expression, context, signatures) ===
      "native"
  );
}

/**
 * `const cells = rows[r].split(",")` names its receiver first, as
 * `const __recv = rows[r], cells = __recv.split(",")`. The receiver is still
 * evaluated once, in order, and the split array gains a stable root.
 */
function nameSplitReceivers(
  body: Node,
  declaration: FunctionDeclaration,
  context: FunctionContext,
  signatures: FunctionSignatures,
): boolean {
  let named = 0;
  walk(body, (node): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (!(node instanceof VariableStatement)) return;
    for (let i = 0; i < node.declarations.length; i++) {
      const local = node.declarations[i];
      const split = local.initializer;
      if (
        local.type ||
        local.decorators?.length ||
        !local.is(CommonFlags.Const) ||
        !(split instanceof CallExpression) ||
        isStrStaticCall(split) ||
        split.args.length !== 1 ||
        !(split.args[0] instanceof StringLiteralExpression) ||
        !split.args[0].value.length
      )
        continue;
      const property = propertyCall(split);
      const receiver = property?.expression;
      if (
        property?.property.text !== "split" ||
        !receiver ||
        receiver instanceof IdentifierExpression ||
        receiver instanceof StringLiteralExpression ||
        !(
          expressionRepresentation(receiver, context, signatures) ===
            "native" || nativeSplitElement(receiver, context, signatures)
        )
      )
        continue;
      let name = `__as_str_split_receiver_${named}`;
      while (
        local.range.source.text.includes(name) ||
        context.bindings.has(name) ||
        context.parameters.has(name)
      )
        name += "_";
      node.declarations.splice(
        i,
        0,
        Node.createVariableDeclaration(
          identifier(name, local.name.range),
          null,
          CommonFlags.Const,
          null,
          receiver,
          local.name.range,
        ),
      );
      property.expression = identifier(name, split.range);
      i++;
      named++;
    }
  });
  return named > 0;
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

/** Names of the cursors that split loops read their fields through. */
export const SPLIT_CURSOR_PREFIX = "__as_str_field_";

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
    const target = writeTarget(node);
    if (target instanceof IdentifierExpression && target.text === index)
      written = true;
    if (!(node instanceof IdentifierExpression) || node.text !== index) return;
    const parent = ref.parent;
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
  if (nameSplitReceivers(body, declaration, context, signatures))
    return "declared";
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
    if (split && isStable(binding.name)) candidates.set(local, split);
  }
  if (!candidates.size) return false;
  const loops = new Map<VariableDeclaration, SplitLoop[]>();
  const parents = new Map<Node, Node>();
  const writtenTargets = new Set<Expression>();
  walk(body, (node, ref): boolean | void => {
    if (ref.parent) parents.set(node, ref.parent);
    const target = writeTarget(node);
    if (target) writtenTargets.add(target);
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
    const written = parent instanceof Expression && writtenTargets.has(parent);
    const split = candidates.get(local)!;
    if (
      parent instanceof ElementAccessExpression &&
      expressionRepresentation(split.receiver, context, signatures) === "view"
    ) {
      // View elements are mutable objects. Only direct read-only observations
      // may be reconstructed; aliases, arguments and mutators keep the array.
      const use = parents.get(parent);
      const call = use ? parents.get(use) : null;
      const readOnly =
        use instanceof PropertyAccessExpression &&
        use.expression === parent &&
        (use.property.text === "length" ||
          use.property.text === "isEmpty" ||
          (operationSemantics(use.property.text).spanScalar &&
            call instanceof CallExpression &&
            call.expression === use));
      if (!readOnly) {
        candidates.delete(local);
        return;
      }
    }
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

  // Save the receiver at the original split evaluation point. A native string
  // binding can be reassigned, and even a const Str binding has a mutable range.
  // A view slice captures that range and keeps its original backing data rooted.
  let snapshots = 0;
  walk(body, (node): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (!(node instanceof VariableStatement)) return;
    const declarations: VariableDeclaration[] = [];
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
          const capture = Node.createVariableDeclaration(
            identifier(name, local.range),
            null,
            CommonFlags.Const,
            view ? viewType(local.range) : null,
            snapshot,
            local.range,
          );
          if (view) retainedViewSnapshots.add(capture);
          declarations.push(capture);
          split.receiver = identifier(name, receiver.range);
          local.initializer = splitCall(split, local.initializer!.range);
        }
      }
      declarations.push(local);
    }
    node.declarations = declarations;
  });

  // Each loop reads its fields through a cursor declared beside its counter.
  const cursors = new Map<ElementAccessExpression, string>();
  let declared = snapshots > 0;
  for (const [array, split] of candidates) {
    for (const { loop, accesses } of loops.get(array) ?? []) {
      if (!accesses.size) continue;
      // Scope resolution is positional: declare the cursor where the counter
      // is declared, and read it where the incrementor reads.
      const counter = (loop.initializer as VariableStatement).declarations[0];
      const range = counter.range;
      const stepRange = loop.incrementor!.range;
      let name = `${SPLIT_CURSOR_PREFIX}${cursors.size}`;
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
