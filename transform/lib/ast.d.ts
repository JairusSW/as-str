import {
  Expression,
  IdentifierExpression,
  NamedTypeNode,
  Source,
  TypeNode,
} from "assemblyscript/dist/assemblyscript.js";
export type Representation = "native" | "view" | "unknown";
export declare function typeName(type: TypeNode | null): string | null;
export declare function representationOfType(
  type: TypeNode | null,
): Representation;
export declare function elementRepresentationOfType(
  type: TypeNode | null,
): Representation;
export declare function viewType(range: Source["range"]): NamedTypeNode;
export declare function i32Type(range: Source["range"]): NamedTypeNode;
export declare function u64Type(range: Source["range"]): NamedTypeNode;
export declare function identifier(
  name: string,
  range: Source["range"],
): IdentifierExpression;
export declare function staticViewCall(
  method: string,
  receiver: Expression,
  args: Expression[],
): Expression;
export declare function wrapAsView(expression: Expression): Expression;
export declare function materializeView(expression: Expression): Expression;
export declare function parseExpression(text: string): Expression;
