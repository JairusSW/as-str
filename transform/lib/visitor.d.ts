import {
  Expression,
  IdentifierExpression,
  Node,
  PropertyAccessExpression,
  CallExpression,
} from "assemblyscript/dist/assemblyscript.js";
export interface WalkRef {
  parent: Node | null;
  key: string | null;
  grandparent: Node | null;
}
export declare function walk(
  node: Node | null,
  visitor: (node: Node, ref: WalkRef) => boolean | void,
  parent?: Node | null,
  key?: string | null,
  grandparent?: Node | null,
): void;
export declare function calleeName(expression: Expression): string | null;
export declare function propertyCall(
  call: CallExpression,
): PropertyAccessExpression | null;
export declare function isStrStaticCall(call: CallExpression): boolean;
export declare function isDeclarationIdentifier(
  node: IdentifierExpression,
  ref: WalkRef,
): boolean;
