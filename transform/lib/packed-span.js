import {
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ElementAccessExpression,
  ExpressionStatement,
  IdentifierExpression,
  Node,
  ParenthesizedExpression,
  IntegerLiteralExpression,
  PropertyAccessExpression,
  StringLiteralExpression,
  TernaryExpression,
} from "assemblyscript/dist/assemblyscript.js";
import {
  identifier,
  integer,
  legacyNativeTrimSources,
  expressionRangeKey,
  loweredSpanCalls,
  spanReturnCalls,
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
export function viewCallParts(expression) {
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
function parameterCanUsePackedSpan(body, name, references) {
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
  for (const { node, ref } of references) {
    if (
      deferredLowercase &&
      assignment &&
      node.range.start >= assignment.range.start &&
      node.range.end <= assignment.range.end
    )
      continue;
    uses++;
    if (
      !deferredLowercase &&
      ref.parent instanceof PropertyAccessExpression &&
      ref.key === "expression"
    ) {
      const member = ref.parent.property.text;
      if (member === "length" || member === "isEmpty") continue;
      if (
        operationSemantics(member).spanScalar &&
        ref.grandparent instanceof CallExpression &&
        ref.grandparent.expression === ref.parent
      ) {
        continue;
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
      continue;
    }
    safe = false;
  }
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
  const parameterUses = new Map();
  const names = new Set(
    declaration.signature.parameters.map((parameter) => parameter.name.text),
  );
  const usedInDefaults = new Set();
  for (const parameter of declaration.signature.parameters) {
    walk(parameter.initializer, (node, ref) => {
      if (
        node instanceof IdentifierExpression &&
        names.has(node.text) &&
        !isDeclarationIdentifier(node, ref)
      )
        usedInDefaults.add(node.text);
    });
  }
  walk(body, (node, ref) => {
    if (
      !(node instanceof IdentifierExpression) ||
      !names.has(node.text) ||
      isDeclarationIdentifier(node, ref) ||
      context.classes.declarationOf(node, context)
    )
      return;
    const references = parameterUses.get(node.text) ?? [];
    references.push({ node, ref });
    parameterUses.set(node.text, references);
  });
  if (signature.directCallCount > 0) {
    declaration.signature.parameters.forEach((parameter, index) => {
      if (signature.spanParameters.has(index)) return;
      if (representationOfType(parameter.type) !== "native") return;
      if (usedInDefaults.has(parameter.name.text)) return;
      const packed = parameterCanUsePackedSpan(
        body,
        parameter.name.text,
        parameterUses.get(parameter.name.text) ?? [],
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
export function splitField(expression) {
  if (!(expression instanceof ElementAccessExpression)) return null;
  const split = expression.expression;
  if (!(split instanceof CallExpression) || isStrStaticCall(split)) return null;
  const property = propertyCall(split);
  const separator = split.args[0];
  let index = expression.elementExpression;
  while (index instanceof ParenthesizedExpression) index = index.expression;
  if (
    !(
      index instanceof IntegerLiteralExpression ||
      index instanceof IdentifierExpression
    )
  )
    return null;
  if (
    property?.property.text !== "split" ||
    split.args.length !== 1 ||
    split.typeArguments?.length ||
    !(separator instanceof StringLiteralExpression) ||
    !separator.value.length
  )
    return null;
  return {
    receiver: property.expression,
    separator,
    index: expression.elementExpression,
  };
}
export function spanReturnCall(expression) {
  return expression instanceof CallExpression && spanReturnCalls.has(expression)
    ? expression
    : null;
}
export function isSpanLink(expression) {
  return (
    isSpanCall(expression) ||
    !!splitField(expression) ||
    !!spanReturnCall(expression)
  );
}
export function spanLinkReceiver(expression) {
  const field = splitField(expression);
  if (field) return field.receiver;
  const returned = spanReturnCall(expression);
  if (returned) return returned.args[spanReturnCalls.get(returned)];
  if (!(expression instanceof CallExpression)) return null;
  const parts = viewCallParts(expression);
  return parts && operationSemantics(parts.method).spanProducing
    ? parts.receiver
    : null;
}
function isEmptyLiteral(expression) {
  return (
    expression instanceof StringLiteralExpression && !expression.value.length
  );
}
export function spanTernary(expression) {
  if (!(expression instanceof TernaryExpression)) return null;
  const branches = [expression.ifThen, expression.ifElse];
  if (
    !branches.some(isSpanLink) ||
    !branches.every(
      (branch) =>
        isSpanLink(branch) ||
        branch instanceof IdentifierExpression ||
        branch instanceof StringLiteralExpression,
    )
  )
    return null;
  if (branches.some(isEmptyLiteral)) return expression;
  const [left, right] = branches.map((branch) => spanChainRoot(branch));
  return (left instanceof IdentifierExpression &&
    right instanceof IdentifierExpression &&
    left.text === right.text) ||
    (left instanceof StringLiteralExpression &&
      right instanceof StringLiteralExpression &&
      left.value === right.value)
    ? expression
    : null;
}
export function spanChainRoot(expression) {
  const ternary = spanTernary(expression);
  if (ternary)
    return spanChainRoot(
      isEmptyLiteral(ternary.ifThen) ? ternary.ifElse : ternary.ifThen,
    );
  let current = expression;
  for (
    let receiver = spanLinkReceiver(current);
    receiver;
    receiver = spanLinkReceiver(current)
  )
    current = receiver;
  return current;
}
export function spanChainOwner(expression, context) {
  const root = spanChainRoot(expression);
  if (root instanceof StringLiteralExpression) return root;
  if (!(root instanceof IdentifierExpression)) return null;
  const binding = context.classes.bindingOf(root, context);
  return binding?.scalarizedSpan && binding.packedSpan
    ? spanOwnerExpression(binding.packedSpan.owner, root.range)
    : root;
}
export function isSpanCall(expression) {
  if (!(expression instanceof CallExpression)) return false;
  const parts = viewCallParts(expression);
  return !!parts && operationSemantics(parts.method).spanProducing;
}
function nativeTrim(expression, context) {
  const parts = viewCallParts(expression);
  return (
    !!parts &&
    parts.method === "trim" &&
    legacyNativeTrimSources.has(expression.range.source) &&
    !isStrStaticCall(expression) &&
    !context.originalViewReceivers?.has(expressionRangeKey(parts.receiver))
  );
}
export function lowerPackedSpanInitializer(expression, context) {
  const ternary = spanTernary(expression);
  if (ternary) {
    const root = spanChainRoot(ternary);
    const packed = (value) =>
      value instanceof IdentifierExpression &&
      !!context.classes.bindingOf(value, context)?.scalarizedSpan;
    const empty = (range) => {
      const copy =
        root instanceof IdentifierExpression
          ? identifier(root.text, range)
          : Node.createStringLiteralExpression(root.value, range);
      const zero = () => integer(0, copy);
      return packed(root)
        ? staticViewCall("sliceSpanOf", copy, [zero(), zero()])
        : staticViewCall("sliceSpan", copy, [zero(), zero()]);
    };
    const branch = (value) =>
      isSpanLink(value)
        ? lowerPackedSpanInitializer(value, context)
        : isEmptyLiteral(value)
          ? empty(value.range)
          : packed(value)
            ? value
            : staticViewCall("wholeSpan", value, []);
    return Node.createTernaryExpression(
      ternary.condition,
      branch(ternary.ifThen),
      branch(ternary.ifElse),
      ternary.range,
    );
  }
  const returned = spanReturnCall(expression);
  if (returned) {
    loweredSpanCalls.add(returned);
    return returned;
  }
  const field = splitField(expression);
  if (field) {
    const args = [field.separator, field.index];
    if (isSpanLink(field.receiver))
      return staticViewCall(
        "splitFieldSpanOf",
        lowerPackedSpanInitializer(field.receiver, context),
        args,
      );
    if (
      field.receiver instanceof IdentifierExpression &&
      context.classes.bindingOf(field.receiver, context)?.scalarizedSpan
    )
      return staticViewCall("splitFieldSpanOf", field.receiver, args);
    return staticViewCall("splitFieldSpan", field.receiver, args);
  }
  if (!(expression instanceof CallExpression)) return expression;
  const parts = viewCallParts(expression);
  if (!parts) return expression;
  const method = nativeTrim(expression, context)
    ? "nativeTrim"
    : operationSemantics(parts.method).normalizedSpanName;
  if (isSpanLink(parts.receiver)) {
    return staticViewCall(
      `${method}SpanOf`,
      lowerPackedSpanInitializer(parts.receiver, context),
      parts.args,
    );
  }
  if (
    parts.receiver instanceof IdentifierExpression &&
    context.classes.bindingOf(parts.receiver, context)?.scalarizedSpan
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
    (parts.receiver instanceof IdentifierExpression &&
      context.classes.bindingOf(parts.receiver, context)?.scalarizedSpan) ||
    (isSpanCall(expression) && isSpanLink(parts.receiver))
  ) {
    const owner = spanChainOwner(expression, context);
    if (owner)
      return staticViewCall("spanLength", owner, [
        lowerPackedSpanInitializer(expression, context),
      ]);
  }
  if (nativeTrim(expression, context))
    return staticViewCall("nativeTrimLength", parts.receiver, parts.args);
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
