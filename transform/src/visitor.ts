import {
  ClassDeclaration,
  Expression,
  FunctionDeclaration,
  IdentifierExpression,
  ImportDeclaration,
  NamespaceDeclaration,
  Node,
  PropertyAccessExpression,
  CallExpression,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";

export interface WalkRef {
  parent: Node | null;
  key: string | null;
  grandparent: Node | null;
}

function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && "kind" in value;
}

// Every AST class assigns the same own properties in its constructor, so the
// properties that can hold children are computed once per class.
const childKeys = new Map<unknown, string[]>();

function childKeysOf(node: Node): string[] {
  let keys = childKeys.get(node.constructor);
  if (!keys) {
    const record = node as unknown as Record<string, unknown>;
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

/** Lightweight recursive visitor following the source-first json-as pattern. */
export function walk(
  node: Node | null,
  visitor: (node: Node, ref: WalkRef) => boolean | void,
  parent: Node | null = null,
  key: string | null = null,
  grandparent: Node | null = null,
): void {
  if (!node) return;
  if (visitor(node, { parent, key, grandparent }) === false) return;

  // Snapshot values before visiting children: a visitor may replace a sibling.
  const keys = childKeysOf(node);
  const values: unknown[] = new Array(keys.length);
  for (let i = 0; i < keys.length; i++)
    values[i] = (node as unknown as Record<string, unknown>)[keys[i]];
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

export function calleeName(expression: Expression): string | null {
  return expression instanceof IdentifierExpression ? expression.text : null;
}

export function propertyCall(
  call: CallExpression,
): PropertyAccessExpression | null {
  return call.expression instanceof PropertyAccessExpression
    ? call.expression
    : null;
}

export function isStrStaticCall(call: CallExpression): boolean {
  const property = propertyCall(call);
  return (
    !!property &&
    property.expression instanceof IdentifierExpression &&
    property.expression.text === "str"
  );
}

export function isDeclarationIdentifier(
  node: IdentifierExpression,
  ref: WalkRef,
): boolean {
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
