import {
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ElementAccessExpression,
  Expression,
  ExpressionStatement,
  IdentifierExpression,
  Node,
  ParameterKind,
  PropertyAccessExpression,
  Range,
  Statement,
  StringLiteralExpression,
  TernaryExpression,
  Token,
} from "assemblyscript/dist/assemblyscript.js";
import {
  identifier,
  legacyNativeTrimSources,
  expressionRangeKey,
  loweredSpanCalls,
  spanReturnCalls,
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

export function viewCallParts(
  expression: CallExpression,
): ViewCallParts | null {
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

interface SplitField {
  receiver: Expression;
  separator: StringLiteralExpression;
  index: Expression;
}

/** `receiver.split("sep")[index]` with a non-empty literal separator. */
export function splitField(expression: Expression): SplitField | null {
  if (!(expression instanceof ElementAccessExpression)) return null;
  const split = expression.expression;
  if (!(split instanceof CallExpression) || isStrStaticCall(split)) return null;
  const property = propertyCall(split);
  const separator = split.args[0];
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

/** A call returning a packed span of its argument at `spanReturnCalls`. */
export function spanReturnCall(expression: Expression): CallExpression | null {
  return expression instanceof CallExpression && spanReturnCalls.has(expression)
    ? expression
    : null;
}

/** A span operation, split field or span-returning call over its receiver. */
export function isSpanLink(expression: Expression): boolean {
  return (
    isSpanCall(expression) ||
    !!splitField(expression) ||
    !!spanReturnCall(expression)
  );
}

export function spanLinkReceiver(expression: Expression): Expression | null {
  const field = splitField(expression);
  if (field) return field.receiver;
  const returned = spanReturnCall(expression);
  if (returned) return returned.args[spanReturnCalls.get(returned)!];
  if (!(expression instanceof CallExpression)) return null;
  const parts = viewCallParts(expression);
  return parts && operationSemantics(parts.method).spanProducing
    ? parts.receiver
    : null;
}

/**
 * `condition ? a : b` whose branches are each a span link or a bare root, all
 * over the same root: either branch is one span of that root.
 */
export function spanTernary(expression: Expression): TernaryExpression | null {
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

/** The receiver at the root of a chain of span links. */
export function spanChainRoot(expression: Expression): Expression {
  const ternary = spanTernary(expression);
  if (ternary) return spanChainRoot(ternary.ifThen);
  let current = expression;
  for (
    let receiver = spanLinkReceiver(current);
    receiver;
    receiver = spanLinkReceiver(current)
  )
    current = receiver;
  return current;
}

/**
 * The string that keeps a span chain's memory alive, as an expression that is
 * safe to evaluate again: the root itself, or a packed root's own owner.
 */
export function spanChainOwner(
  expression: Expression,
  context: FunctionContext,
): Expression | null {
  const root = spanChainRoot(expression);
  if (root instanceof StringLiteralExpression) return root;
  if (!(root instanceof IdentifierExpression)) return null;
  const binding = context.classes.bindingOf(root, context);
  return binding?.scalarizedSpan && binding.packedSpan
    ? spanOwnerExpression(binding.packedSpan.owner, root.range)
    : root;
}

export function isSpanCall(
  expression: Expression,
): expression is CallExpression {
  if (!(expression instanceof CallExpression)) return false;
  const parts = viewCallParts(expression);
  return !!parts && operationSemantics(parts.method).spanProducing;
}

function nativeTrim(
  expression: CallExpression,
  context: FunctionContext,
): boolean {
  const parts = viewCallParts(expression);
  return (
    !!parts &&
    parts.method === "trim" &&
    legacyNativeTrimSources.has(expression.range.source) &&
    !isStrStaticCall(expression) &&
    !context.originalViewReceivers?.has(expressionRangeKey(parts.receiver))
  );
}

export function lowerPackedSpanInitializer(
  expression: Expression,
  context: FunctionContext,
): Expression {
  const ternary = spanTernary(expression);
  if (ternary) {
    const branch = (value: Expression): Expression =>
      isSpanLink(value)
        ? lowerPackedSpanInitializer(value, context)
        : value instanceof IdentifierExpression &&
            context.classes.bindingOf(value, context)?.scalarizedSpan
          ? value
          : staticViewCall("wholeSpan", value, []);
    return Node.createTernaryExpression(
      ternary.condition,
      branch(ternary.ifThen),
      branch(ternary.ifElse),
      ternary.range,
    );
  }
  // A span-returning call already yields the span of its argument.
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
  // Each link of a chain narrows the span of the link before it.
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

export function lowerPackedLengthInitializer(
  expression: CallExpression,
  context: FunctionContext,
): Expression {
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
