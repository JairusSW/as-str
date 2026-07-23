import {
  ClassDeclaration,
  Expression,
  FunctionDeclaration,
  IdentifierExpression,
  ImportDeclaration,
  NamespaceDeclaration,
  PropertyAccessExpression,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
function isNode(value) {
  return !!value && typeof value === "object" && "kind" in value;
}
export function walk(
  node,
  visitor,
  parent = null,
  key = null,
  grandparent = null,
) {
  if (!node) return;
  if (visitor(node, { parent, key, grandparent }) === false) return;
  for (const [childKey, value] of Object.entries(node)) {
    if (
      childKey === "range" ||
      childKey === "implicitFieldDeclaration" ||
      childKey === "kind"
    ) {
      continue;
    }
    if (isNode(value)) {
      walk(value, visitor, node, childKey, parent);
    } else if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) walk(child, visitor, node, childKey, parent);
      }
    }
  }
}
export function calleeName(expression) {
  return expression instanceof IdentifierExpression ? expression.text : null;
}
export function propertyCall(call) {
  return call.expression instanceof PropertyAccessExpression
    ? call.expression
    : null;
}
export function isStrStaticCall(call) {
  const property = propertyCall(call);
  return (
    !!property &&
    property.expression instanceof IdentifierExpression &&
    property.expression.text === "str"
  );
}
export function isDeclarationIdentifier(node, ref) {
  const parent = ref.parent;
  if (!parent) return false;
  if (
    parent instanceof ImportDeclaration ||
    ((parent instanceof VariableDeclaration ||
      parent instanceof FunctionDeclaration ||
      parent instanceof ClassDeclaration ||
      parent instanceof NamespaceDeclaration) &&
      ref.key === "name")
  ) {
    return true;
  }
  if (parent instanceof PropertyAccessExpression && ref.key === "property") {
    return true;
  }
  return ref.key === "name" && !(parent instanceof Expression);
}
