import {
  NamedTypeNode,
  Node,
  Parser,
  Source,
  Tokenizer,
} from "assemblyscript/dist/assemblyscript.js";
import { arrayElementType, stringRepresentation } from "./type-resolution.js";
import { requestViewTypeAlias } from "./view-aliases.js";
export function typeName(type) {
  if (!(type instanceof NamedTypeNode)) return null;
  const parts = [];
  let current = type.name;
  while (current) {
    parts.push(current.identifier.text);
    current = current.next;
  }
  return parts.join(".");
}
export function representationOfType(type, nonNull = false) {
  return stringRepresentation(type, nonNull);
}
export function elementRepresentationOfType(type) {
  return representationOfType(arrayElementType(type));
}
export function viewType(range) {
  const type = Node.createNamedType(
    Node.createSimpleTypeName("str", range),
    null,
    false,
    range,
  );
  return stringRepresentation(type) === "view"
    ? type
    : Node.createNamedType(
        Node.createSimpleTypeName(requestViewTypeAlias(range.source), range),
        null,
        false,
        range,
      );
}
export function i32Type(range) {
  return Node.createNamedType(
    Node.createSimpleTypeName("i32", range),
    null,
    false,
    range,
  );
}
export function u64Type(range) {
  return Node.createNamedType(
    Node.createSimpleTypeName("u64", range),
    null,
    false,
    range,
  );
}
export function expressionRangeKey(expression) {
  const range = expression.range;
  return `${range.source.normalizedPath}:${range.start}:${range.end}`;
}
export function identifier(name, range) {
  return Node.createIdentifierExpression(name, range, false);
}
export function staticViewCall(method, receiver, args) {
  const range = receiver.range;
  const staticMethod =
    method === "trimLeft"
      ? "trimStart"
      : method === "trimRight"
        ? "trimEnd"
        : method;
  return Node.createCallExpression(
    Node.createPropertyAccessExpression(
      identifier("str", range),
      identifier(staticMethod, range),
      range,
    ),
    null,
    [receiver, ...args],
    range,
  );
}
export function wrapAsView(expression) {
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
export function wrapUnknownAsView(expression) {
  const range = expression.range;
  return Node.createCallExpression(
    identifier("str", range),
    null,
    [expression],
    range,
  );
}
export function materializeView(expression) {
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
export function parseExpression(text) {
  const parser = new Parser();
  const source = new Source(0, "~as-str/generated.ts", text);
  const expression = parser.parseExpression(new Tokenizer(source));
  if (!expression)
    throw new Error(`[as-str] unable to parse expression: ${text}`);
  return expression;
}
