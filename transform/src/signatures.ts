import {
  CallExpression,
  FunctionDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { FunctionContext, FunctionSignature } from "./model.js";
import { calleeName, propertyCall } from "./visitor.js";

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
  return declaration ? signatures.forDeclaration(declaration) : undefined;
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
