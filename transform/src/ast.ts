import {
  Expression,
  Token,
  IdentifierExpression,
  NamedTypeNode,
  Node,
  Parser,
  Source,
  Tokenizer,
  TypeNode,
} from "assemblyscript/dist/assemblyscript.js";
import { arrayElementType, stringRepresentation } from "./type-resolution.js";
import { requestViewTypeAlias } from "./view-aliases.js";

export type Representation = "native" | "view" | "unknown";

/**
 * Types the optimizer writes onto rewritten declarations. Semantic analysis of
 * a preliminarily rewritten program must not report them as source types.
 */
export const generatedTypes = new WeakSet<TypeNode>();

function generated<T extends TypeNode>(type: T): T {
  generatedTypes.add(type);
  return type;
}

export function typeName(type: TypeNode | null): string | null {
  if (!(type instanceof NamedTypeNode)) return null;
  const parts: string[] = [];
  let current = type.name;
  while (current) {
    parts.push(current.identifier.text);
    current = current.next;
  }
  return parts.join(".");
}

export function representationOfType(
  type: TypeNode | null,
  nonNull = false,
): Representation {
  return stringRepresentation(type, nonNull);
}

export function elementRepresentationOfType(
  type: TypeNode | null,
): Representation {
  return representationOfType(arrayElementType(type));
}

export function viewType(range: Source["range"]): NamedTypeNode {
  const type = Node.createNamedType(
    Node.createSimpleTypeName("str", range),
    null,
    false,
    range,
  );
  return generated(
    stringRepresentation(type) === "view"
      ? type
      : Node.createNamedType(
          Node.createSimpleTypeName(requestViewTypeAlias(range.source), range),
          null,
          false,
          range,
        ),
  );
}

export function i32Type(range: Source["range"]): NamedTypeNode {
  return generated(
    Node.createNamedType(
      Node.createSimpleTypeName("i32", range),
      null,
      false,
      range,
    ),
  );
}

export function u64Type(range: Source["range"]): NamedTypeNode {
  return generated(
    Node.createNamedType(
      Node.createSimpleTypeName("u64", range),
      null,
      false,
      range,
    ),
  );
}

/** Stable identity for an original expression, including nested expressions. */
export function expressionRangeKey(expression: Expression): string {
  const range = expression.range;
  return `${range.source.normalizedPath}:${range.start}:${range.end}`;
}

export function identifier(
  name: string,
  range: Source["range"],
): IdentifierExpression {
  return Node.createIdentifierExpression(name, range, false);
}

/**
 * Runtime helper calls the rewriter emits. A later optimization round must not
 * read their arguments as view boundaries of the source program.
 */
export const generatedCalls = new WeakSet<Expression>();

export function staticViewCall(
  method: string,
  receiver: Expression,
  args: Expression[],
): Expression {
  const range = receiver.range;
  const staticMethod =
    method === "trimLeft"
      ? "trimStart"
      : method === "trimRight"
        ? "trimEnd"
        : method;
  const call = Node.createCallExpression(
    Node.createPropertyAccessExpression(
      identifier("str", range),
      identifier(staticMethod, range),
      range,
    ),
    null,
    [receiver, ...args],
    range,
  );
  generatedCalls.add(call);
  return call;
}

export function wrapAsView(expression: Expression): Expression {
  const range = expression.range;
  return Node.createCallExpression(
    Node.createPropertyAccessExpression(
      identifier("str", range),
      identifier("from", range),
      range,
    ),
    null,
    [expression],
    range,
  );
}

export function wrapUnknownAsView(expression: Expression): Expression {
  const range = expression.range;
  return Node.createCallExpression(
    identifier("str", range),
    null,
    [expression],
    range,
  );
}

export function materializeView(expression: Expression): Expression {
  const range = expression.range;
  return Node.createCallExpression(
    Node.createPropertyAccessExpression(
      expression,
      identifier("toString", range),
      range,
    ),
    null,
    [],
    range,
  );
}

/** Parse small transform-generated expressions without taking a runtime parser dependency. */
export function parseExpression(text: string): Expression {
  const parser = new Parser();
  const source = new Source(0, "~as-str/generated.ts", text);
  const expression = parser.parseExpression(new Tokenizer(source));
  if (!expression)
    throw new Error(`[as-str] unable to parse expression: ${text}`);
  return expression;
}

// AssemblyScript installs its portable 64-bit integer constructor globally.
function i64(value: number): ReturnType<typeof i64_new> {
  return (globalThis as unknown as { i64_new: typeof i64_new }).i64_new(
    value,
    0,
  );
}

export function integer(value: number, expression: Expression): Expression {
  return value < 0
    ? Node.createUnaryPrefixExpression(
        Token.Minus,
        Node.createIntegerLiteralExpression(i64(-value), expression.range),
        expression.range,
      )
    : Node.createIntegerLiteralExpression(i64(value), expression.range);
}
