import {
  BinaryExpression,
  CallExpression,
  IdentifierExpression,
  Node,
  PropertyAccessExpression,
  StringLiteralExpression,
} from "assemblyscript/dist/assemblyscript.js";
import {
  identifier,
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
function parameterCanUsePackedSpan(body, name) {
  let safe = true;
  let uses = 0;
  let firstLowercase = Number.MAX_SAFE_INTEGER;
  walk(body, (node) => {
    if (
      node instanceof BinaryExpression &&
      node.operator === 101 &&
      node.left instanceof IdentifierExpression &&
      node.left.text === name &&
      node.right instanceof CallExpression
    ) {
      const property = propertyCall(node.right);
      if (
        property?.property.text === "toLowerCase" &&
        property.expression instanceof IdentifierExpression &&
        property.expression.text === name
      ) {
        firstLowercase = Math.min(firstLowercase, node.range.start);
      }
    }
  });
  walk(body, (node, ref) => {
    if (
      !(node instanceof IdentifierExpression) ||
      node.text !== name ||
      isDeclarationIdentifier(node, ref)
    ) {
      return;
    }
    uses++;
    if (ref.parent instanceof BinaryExpression) {
      const binary = ref.parent;
      if (
        binary.operator === 101 &&
        binary.left instanceof IdentifierExpression &&
        binary.left.text === name &&
        binary.right instanceof CallExpression
      ) {
        const property = propertyCall(binary.right);
        if (
          property?.property.text === "toLowerCase" &&
          property.expression instanceof IdentifierExpression &&
          property.expression.text === name
        ) {
          return;
        }
      }
      if (
        (binary.operator === 76 ||
          binary.operator === 78 ||
          binary.operator === 77 ||
          binary.operator === 79) &&
        firstLowercase !== Number.MAX_SAFE_INTEGER
      ) {
        const other = binary.left === node ? binary.right : binary.left;
        if (
          binary.range.start < firstLowercase &&
          other instanceof StringLiteralExpression &&
          /[A-Za-z]/.test(other.value)
        ) {
          safe = false;
        }
        return;
      }
    }
    if (
      ref.parent instanceof PropertyAccessExpression &&
      ref.key === "expression"
    ) {
      const member = ref.parent.property.text;
      if (member === "length" || member === "isEmpty") return;
      if (
        member === "toLowerCase" &&
        firstLowercase !== Number.MAX_SAFE_INTEGER
      ) {
        return;
      }
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
      return;
    }
    safe = false;
  });
  return {
    safe: safe && uses > 0,
    caseInsensitive: firstLowercase !== Number.MAX_SAFE_INTEGER,
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
      const packed = parameterCanUsePackedSpan(body, parameter.name.text);
      if (
        signature.spanArgumentCounts.get(index) !== signature.directCallCount ||
        !packed.safe
      ) {
        return;
      }
      signature.spanParameters.set(
        index,
        `__as_str_owner_${parameter.name.text}`,
      );
      if (packed.caseInsensitive) {
        signature.caseInsensitiveSpanParameters.add(index);
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
        context.parameterSpans.set(parameter.name.text, ownerName);
        if (signature.caseInsensitiveSpanParameters.has(index)) {
          context.caseInsensitiveSpans.add(parameter.name.text);
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
      identifier(receiver.spanOwner, expression.range),
      [span],
    );
  }
  return staticViewCall(`${parts.method}Length`, parts.receiver, parts.args);
}
export function packedSpanOwner(name, context) {
  return (
    context.bindings.get(name)?.spanOwner ??
    context.parameterSpans.get(name) ??
    null
  );
}
