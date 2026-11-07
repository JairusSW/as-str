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
const childKeys = new Map();
function childKeysOf(node) {
  let keys = childKeys.get(node.constructor);
  if (!keys) {
    const record = node;
    keys = Object.keys(node).filter(
      (key) =>
        key !== "range" &&
        key !== "implicitFieldDeclaration" &&
        key !== "kind" &&
        (record[key] === null ||
          record[key] === undefined ||
          typeof record[key] === "object"),
    );
    childKeys.set(node.constructor, keys);
  }
  return keys;
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
  const keys = childKeysOf(node);
  const values = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) values[i] = node[keys[i]];
  for (let i = 0; i < keys.length; i++) {
    const value = values[i];
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) walk(child, visitor, node, keys[i], parent);
      }
    } else if (isNode(value)) {
      walk(value, visitor, node, keys[i], parent);
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
