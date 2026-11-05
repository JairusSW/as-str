import {
  BinaryExpression,
  BlockStatement,
  CallExpression,
  Expression,
  ExpressionStatement,
  IdentifierExpression,
  Node,
  ParameterKind,
  PropertyAccessExpression,
  Range,
  Statement,
  StringLiteralExpression,
  Token,
} from "assemblyscript/dist/assemblyscript.js";
import {
  identifier,
  expressionRangeKey,
  representationOfType,
  staticViewCall,
  u64Type,
} from "./ast.js";
import {
  FunctionContext,
  FunctionSignature,
  PackedSpanLink,
  SpanOwner,
} from "./model.js";
import { operationSemantics } from "./operations.js";
import {
  isDeclarationIdentifier,
  isStrStaticCall,
  propertyCall,
  walk,
  WalkRef,
} from "./visitor.js";

interface ViewCallParts {
  method: string;
  receiver: Expression;
  args: Expression[];
}

function viewCallParts(expression: CallExpression): ViewCallParts | null {
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

function parameterCanUsePackedSpan(
  body: Statement,
  name: string,
  references: { node: IdentifierExpression; ref: WalkRef }[],
): { safe: boolean; lowercase: boolean } {
  let safe = true;
  let uses = 0;
  // Only defer a lowercase assignment that runs before every use. Once deferred,
  // every consumer must compare the lowercase result against a string literal.
  // Length, indexing and conditional assignments need the actual native result.
  const first = body instanceof BlockStatement ? body.statements[0] : null;
  const assignment =
    first instanceof ExpressionStatement &&
    first.expression instanceof BinaryExpression
      ? first.expression
      : null;
  const lowerCall =
    assignment?.operator === Token.Equals &&
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
      (ref.parent.operator === Token.Equals_Equals ||
        ref.parent.operator === Token.Equals_Equals_Equals ||
        ref.parent.operator === Token.Exclamation_Equals ||
        ref.parent.operator === Token.Exclamation_Equals_Equals)
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

export interface PackedSpanParameterPlan {
  apply(): boolean;
}

const NO_PACKED_SPAN_PLAN: PackedSpanParameterPlan = {
  apply: () => false,
};

/**
 * Selects a packed-span parameter plan whose application owns ABI ordering and
 * idempotence. Planning happens before other parameter promotions; applying
 * afterward preserves the original parameter indexes used by both decisions.
 */
export function planPackedSpanParameters(
  context: FunctionContext,
  signature: FunctionSignature | undefined,
): PackedSpanParameterPlan {
  const declaration = context.declaration;
  const body = declaration?.body;
  if (!declaration || !body || !signature?.promotable) {
    return NO_PACKED_SPAN_PLAN;
  }

  const parameterUses = new Map<
    string,
    { node: IdentifierExpression; ref: WalkRef }[]
  >();
  const names = new Set(
    declaration.signature.parameters.map((parameter) => parameter.name.text),
  );
  const usedInDefaults = new Set<string>();
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
      // Defaults execute outside the body rewriter and can refer to earlier
      // parameters. Retain their native ABI until defaults support spans.
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
      // A generated parameter must not redeclare a local or hide a global that
      // the original body references. Reserve earlier plans as well as source
      // names, since distinct parameters can converge on the same suffix.
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
    apply(): boolean {
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
            ParameterKind.Default,
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

export function lowerPackedSpanInitializer(
  expression: CallExpression,
  context: FunctionContext,
): Expression {
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

export function lowerPackedLengthInitializer(
  expression: CallExpression,
  context: FunctionContext,
): Expression {
  const parts = viewCallParts(expression);
  if (!parts || !operationSemantics(parts.method).lengthFusible) {
    return expression;
  }
  if (
    parts.receiver instanceof IdentifierExpression &&
    context.bindings.get(parts.receiver.text)?.scalarizedSpan
  ) {
    const receiver = context.bindings.get(parts.receiver.text)!;
    const span = staticViewCall(
      `${operationSemantics(parts.method).normalizedSpanName}SpanOf`,
      parts.receiver,
      parts.args,
    );
    return staticViewCall(
      "spanLength",
      spanOwnerExpression(receiver.packedSpan!.owner, expression.range),
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

export function spanOwnerExpression(
  owner: SpanOwner,
  range: Range,
): Expression {
  return owner.kind === "identifier"
    ? identifier(owner.name, range)
    : Node.createStringLiteralExpression(owner.value, range);
}

export function packedSpanLink(
  expression: IdentifierExpression,
  context: FunctionContext,
): PackedSpanLink | null {
  const declaration = context.classes.declarationOf(expression, context);
  if (declaration) {
    const binding = context.bindings.get(expression.text);
    return binding?.declaration === declaration ? binding.packedSpan : null;
  }
  return context.parameterSpans.get(expression.text) ?? null;
}
