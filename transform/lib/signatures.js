import { PropertyAccessExpression } from "assemblyscript/dist/assemblyscript.js";
import { calleeName, propertyCall } from "./visitor.js";
import { representationOfType } from "./ast.js";
import { callArgumentType } from "./type-resolution.js";
export function declaredCallType(call, context) {
  return context.classes.callType(call, context) ?? undefined;
}
export class FunctionSignatures extends Map {
  declarations = new Map();
  constructor(source) {
    super();
    if (source) {
      this.includeDeclarations(source);
      for (const [name, signature] of source) super.set(name, signature);
    }
  }
  set(name, signature) {
    super.set(name, signature);
    this.remember(signature);
    return this;
  }
  remember(signature) {
    for (const declaration of signature.declarations)
      this.declarations.set(declaration, signature);
  }
  includeDeclarations(source) {
    for (const [declaration, signature] of source.declarations)
      if (!this.declarations.has(declaration))
        this.declarations.set(declaration, signature);
  }
  forDeclaration(declaration) {
    return this.declarations.get(declaration);
  }
  rejectAmbiguousName(name) {
    for (const [declaration, signature] of this.declarations)
      if (declaration.name.text === name) signature.promotable = false;
    this.delete(name);
  }
}
export function signatureForDeclaration(declaration, signatures) {
  return signatures.forDeclaration(declaration);
}
export function declaredCallSignature(call, context, signatures) {
  const declaration = context.classes.callableOf(call.expression, context);
  const signature = declaration
    ? signatures.forDeclaration(declaration)
    : undefined;
  if (!signature) return undefined;
  const type = context.classes.callType(call, context, declaration);
  if (
    !type ||
    (type === declaration.signature &&
      type.parameters.at(-1)?.parameterKind !== 2)
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
export function signatureForCall(call, context, signatures) {
  const declaration = context.classes.callableOf(call.expression, context);
  if (declaration === null) return undefined;
  if (declaration) return signatureForDeclaration(declaration, signatures);
  if (call.expression instanceof PropertyAccessExpression) return undefined;
  const name = calleeName(call.expression) ?? propertyCall(call)?.property.text;
  return name ? signatures.get(name) : undefined;
}
