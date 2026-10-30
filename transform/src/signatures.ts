import {
  CallExpression,
  FunctionDeclaration,
  FunctionTypeNode,
  ParameterKind,
} from "assemblyscript/dist/assemblyscript.js";
import { FunctionContext, FunctionSignature } from "./model.js";
import { calleeName, propertyCall } from "./visitor.js";
import { representationOfType } from "./ast.js";
import { callArgumentType } from "./type-resolution.js";

export function declaredCallType(
  call: CallExpression,
  context: FunctionContext,
): FunctionTypeNode | undefined {
  return context.classes.callType(call, context) ?? undefined;
}

/** Named fallbacks and exact declarations have different ambiguity rules. */
export class FunctionSignatures extends Map<string, FunctionSignature> {
  private readonly declarations = new Map<
    FunctionDeclaration,
    FunctionSignature
  >();

  constructor(source?: FunctionSignatures) {
    super();
    if (source) {
      this.includeDeclarations(source);
      for (const [name, signature] of source) super.set(name, signature);
    }
  }

  override set(name: string, signature: FunctionSignature): this {
    super.set(name, signature);
    this.remember(signature);
    return this;
  }

  remember(signature: FunctionSignature): void {
    for (const declaration of signature.declarations)
      this.declarations.set(declaration, signature);
  }

  includeDeclarations(source: FunctionSignatures): void {
    for (const [declaration, signature] of source.declarations)
      if (!this.declarations.has(declaration))
        this.declarations.set(declaration, signature);
  }

  forDeclaration(
    declaration: FunctionDeclaration,
  ): FunctionSignature | undefined {
    return this.declarations.get(declaration);
  }

  rejectAmbiguousName(name: string): void {
    for (const [declaration, signature] of this.declarations)
      if (declaration.name.text === name) signature.promotable = false;
    // Keep exact types even when an unresolved short name is unusable.
    this.delete(name);
  }
}

export function signatureForDeclaration(
  declaration: FunctionDeclaration,
  signatures: FunctionSignatures,
): FunctionSignature | undefined {
  return signatures.forDeclaration(declaration);
}

export function declaredCallSignature(
  call: CallExpression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): FunctionSignature | undefined {
  const declaration = context.classes.callableOf(call.expression, context);
  const signature = declaration
    ? signatures.forDeclaration(declaration)
    : undefined;
  if (!signature) return undefined;
  const type = context.classes.callType(call, context, declaration);
  if (
    !type ||
    (type === declaration!.signature &&
      type.parameters.at(-1)?.parameterKind !== ParameterKind.Rest)
  )
    return signature;
  return {
    ...signature,
    parameters: Array.from(
      { length: Math.max(type.parameters.length, call.args.length) },
      (_, index) => representationOfType(callArgumentType(type, index)),
    ),
    result: representationOfType(type.returnType),
  };
}

export function signatureForCall(
  call: CallExpression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): FunctionSignature | undefined {
  const declaration = context.classes.callableOf(call.expression, context);
  if (declaration === null) return undefined;
  if (declaration) return signatureForDeclaration(declaration, signatures);
  const name = calleeName(call.expression) ?? propertyCall(call)?.property.text;
  return name ? signatures.get(name) : undefined;
}
