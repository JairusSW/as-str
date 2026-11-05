import {
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ExpressionStatement,
  IdentifierExpression,
  Node,
  PropertyAccessExpression,
  StringLiteralExpression,
} from "assemblyscript/dist/assemblyscript.js";
import {
  identifier,
  expressionRangeKey,
  representationOfType,
  staticViewCall,
  u64Type,
} from "./ast.js";
import { operationSemantics } from "./operations.js";
import {
  isDeclarationIdentifier,
  isStrStaticCall,
  propertyCall,
  walk,
} from "./visitor.js";
function viewCallParts(expression) {
  const property = propertyCall(expression);
  if (!property) return null;
  if (isStrStaticCall(expression) && expression.args.length > 0) {
    return {
      method: property.property.text,
      receiver: expression.args[0],
      args: expression.args.slice(1),
    };
  }
  return {
    method: property.property.text,
    receiver: property.expression,
    args: expression.args,
  };
}
function parameterCanUsePackedSpan(body, name, context) {
  let safe = true;
  let uses = 0;
  const first = body instanceof BlockStatement ? body.statements[0] : null;
  const assignment =
    first instanceof ExpressionStatement &&
    first.expression instanceof BinaryExpression
      ? first.expression
      : null;
  const lowerCall =
    assignment?.operator === 101 &&
    assignment.left instanceof IdentifierExpression &&
    assignment.left.text === name &&
    assignment.right instanceof CallExpression &&
    assignment.right.args.length === 0
      ? assignment.right
      : null;
  const lowerProperty = lowerCall ? propertyCall(lowerCall) : null;
  const deferredLowercase =
    lowerProperty?.property.text === "toLowerCase" &&
    lowerProperty.expression instanceof IdentifierExpression &&
    lowerProperty.expression.text === name;
  walk(body, (node, ref) => {
    if (deferredLowercase && node === assignment) return false;
    if (
      !(node instanceof IdentifierExpression) ||
      node.text !== name ||
      isDeclarationIdentifier(node, ref) ||
      context.classes.declarationOf(node, context)
    ) {
      return;
    }
    uses++;
    if (
      !deferredLowercase &&
      ref.parent instanceof PropertyAccessExpression &&
      ref.key === "expression"
    ) {
      const member = ref.parent.property.text;
      if (member === "length" || member === "isEmpty") return;
      if (
        operationSemantics(member).spanScalar &&
        ref.grandparent instanceof CallExpression &&
        ref.grandparent.expression === ref.parent
      ) {
        return;
      }
    }
    if (
      ref.parent instanceof BinaryExpression &&
      (ref.parent.operator === 76 ||
        ref.parent.operator === 78 ||
        ref.parent.operator === 77 ||
        ref.parent.operator === 79)
    ) {
      const other =
        ref.parent.left === node ? ref.parent.right : ref.parent.left;
      if (deferredLowercase && !(other instanceof StringLiteralExpression)) {
        safe = false;
      }
      return;
    }
    safe = false;
  });
  return {
    safe: safe && uses > 0,
    lowercase: deferredLowercase,
  };
}
const NO_PACKED_SPAN_PLAN = {
  apply: () => false,
};
export function planPackedSpanParameters(context, signature) {
  const declaration = context.declaration;
  const body = declaration?.body;
  if (!declaration || !body || !signature?.promotable) {
    return NO_PACKED_SPAN_PLAN;
  }
  if (signature.directCallCount > 0) {
    declaration.signature.parameters.forEach((parameter, index) => {
      if (signature.spanParameters.has(index)) return;
      if (representationOfType(parameter.type) !== "native") return;
      let usedInDefault = false;
      for (const other of declaration.signature.parameters) {
        walk(other.initializer, (node, ref) => {
          if (
            node instanceof IdentifierExpression &&
            node.text === parameter.name.text &&
            !isDeclarationIdentifier(node, ref)
          )
            usedInDefault = true;
        });
      }
      if (usedInDefault) return;
      const packed = parameterCanUsePackedSpan(
        body,
        parameter.name.text,
        context,
      );
      if (
        signature.spanArgumentCounts.get(index) !== signature.directCallCount ||
        !packed.safe
      ) {
        return;
      }
      let ownerName = `__as_str_owner_${parameter.name.text}`;
      const plannedOwners = new Set(signature.spanParameters.values());
      while (
        declaration.range.source.text.includes(ownerName) ||
        context.bindings.has(ownerName) ||
        context.parameters.has(ownerName) ||
        plannedOwners.has(ownerName)
      ) {
        ownerName += "_";
      }
      signature.spanParameters.set(index, ownerName);
      if (packed.lowercase) {
        signature.lowercaseSpanParameters.add(index);
      }
    });
  }
  return {
    apply() {
      if (
        signature.spanParameters.size === 0 ||
        signature.spanAppliedDeclarations.has(declaration)
      ) {
        return false;
      }
      const parameters = declaration.signature.parameters;
      const entries = [...signature.spanParameters.entries()].sort(
        ([left], [right]) => right - left,
      );
      for (const [index, ownerName] of entries) {
        const parameter = parameters[index];
        if (!parameter || parameter.name.text === ownerName) continue;
        const nativeType = parameter.type;
        parameter.type = u64Type(parameter.range);
        parameters.splice(
          index + 1,
          0,
          Node.createParameter(
            0,
            identifier(ownerName, parameter.range),
            nativeType,
            null,
            parameter.range,
          ),
        );
        context.parameters.set(parameter.name.text, "unknown");
        context.parameters.set(ownerName, "native");
        context.parameterSpans.set(parameter.name.text, {
          owner: { kind: "identifier", name: ownerName },
        });
        if (signature.lowercaseSpanParameters.has(index)) {
          context.lowercaseSpans.add(parameter.name.text);
        }
      }
      signature.spanAppliedDeclarations.add(declaration);
      return true;
    },
  };
}
export function lowerPackedSpanInitializer(expression, context) {
  const parts = viewCallParts(expression);
  if (!parts) return expression;
  const method = operationSemantics(parts.method).normalizedSpanName;
  if (
    parts.receiver instanceof IdentifierExpression &&
    context.bindings.get(parts.receiver.text)?.scalarizedSpan
  ) {
    return staticViewCall(`${method}SpanOf`, parts.receiver, parts.args);
  }
  return staticViewCall(`${method}Span`, parts.receiver, parts.args);
}
export function lowerPackedLengthInitializer(expression, context) {
  const parts = viewCallParts(expression);
  if (!parts || !operationSemantics(parts.method).lengthFusible) {
    return expression;
  }
  if (
    parts.receiver instanceof IdentifierExpression &&
    context.bindings.get(parts.receiver.text)?.scalarizedSpan
  ) {
    const receiver = context.bindings.get(parts.receiver.text);
    const span = staticViewCall(
      `${operationSemantics(parts.method).normalizedSpanName}SpanOf`,
      parts.receiver,
      parts.args,
    );
    return staticViewCall(
      "spanLength",
      spanOwnerExpression(receiver.packedSpan.owner, expression.range),
      [span],
    );
  }
  const method =
    parts.method === "at" &&
    !isStrStaticCall(expression) &&
    !context.originalViewReceivers?.has(expressionRangeKey(parts.receiver))
      ? "atNative"
      : parts.method;
  return staticViewCall(`${method}Length`, parts.receiver, parts.args);
}
export function spanOwnerExpression(owner, range) {
  return owner.kind === "identifier"
    ? identifier(owner.name, range)
    : Node.createStringLiteralExpression(owner.value, range);
}
export function packedSpanLink(expression, context) {
  const declaration = context.classes.declarationOf(expression, context);
  if (declaration) {
    const binding = context.bindings.get(expression.text);
    return binding?.declaration === declaration ? binding.packedSpan : null;
  }
  return context.parameterSpans.get(expression.text) ?? null;
}
