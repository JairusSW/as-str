import {
  ClassDeclaration,
  Expression,
  FunctionDeclaration,
  IdentifierExpression,
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
    (parent instanceof VariableDeclaration ||
      parent instanceof FunctionDeclaration ||
      parent instanceof ClassDeclaration ||
      parent instanceof NamespaceDeclaration) &&
    ref.key === "name"
  ) {
    return true;
  }
  if (parent instanceof PropertyAccessExpression && ref.key === "property") {
    return true;
  }
  return ref.key === "name" && !(parent instanceof Expression);
}
