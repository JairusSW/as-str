import { Statement } from "assemblyscript/dist/assemblyscript.js";
import { FunctionContext, FunctionSignature } from "./model.js";
export declare function rewriteStatement(
  statement: Statement,
  context: FunctionContext,
  signatures: Map<string, FunctionSignature>,
): void;
export declare function rewriteDeclarationBoundaries(
  statements: Statement[],
  context: FunctionContext,
  signatures: Map<string, FunctionSignature>,
): void;
