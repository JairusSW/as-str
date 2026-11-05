import { callArgumentType, typeIsNullable } from "./type-resolution.js";
import {
  AssertionExpression,
  AssertionKind,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ClassDeclaration,
  CommaExpression,
  CommonFlags,
  Node,
  NullExpression,
  DoStatement,
  ElementAccessExpression,
  Expression,
  ExpressionStatement,
  FieldDeclaration,
  ForOfStatement,
  ForStatement,
  IdentifierExpression,
  IfStatement,
  LiteralKind,
  NamespaceDeclaration,
  ParenthesizedExpression,
  PropertyAccessExpression,
  ReturnStatement,
  Statement,
  StringLiteralExpression,
  SwitchStatement,
  TernaryExpression,
  ThrowStatement,
  Token,
  TryStatement,
  UnaryPostfixExpression,
  UnaryPrefixExpression,
  VariableStatement,
  WhileStatement,
} from "assemblyscript/dist/assemblyscript.js";
import {
  materializeView,
  elementRepresentationOfType,
  expressionRangeKey,
  identifier,
  parseExpression,
  i32Type,
  Representation,
  representationOfType,
  staticViewCall,
  u64Type,
  viewType,
  wrapAsView,
  wrapUnknownAsView,
} from "./ast.js";
import {
  FunctionSignatures,
  declaredCallSignature,
  declaredCallType,
  signatureForCall,
} from "./signatures.js";
import { containerArgumentKind, operationSemantics } from "./operations.js";
import {
  lowerPackedLengthInitializer,
  lowerPackedSpanInitializer,
  packedSpanLink,
  spanOwnerExpression,
} from "./packed-span.js";
import { expressionCanProduceView } from "./expressions.js";
import { FunctionContext } from "./model.js";
import { calleeName, isStrStaticCall, propertyCall, walk } from "./visitor.js";

const VIEW_NEEDLE_SEARCH = new Set([
  "indexOf",
  "lastIndexOf",
  "includes",
  "startsWith",
  "endsWith",
]);

function foundIndex(call: Expression): Expression {
  const zero = parseExpression("0");
  zero.range = call.range;
  return Node.createBinaryExpression(
    Token.GreaterThan_Equals,
    call,
    zero,
    call.range,
  );
}

function viewCallParts(expression: CallExpression): {
  method: string;
  receiver: Expression;
  args: Expression[];
} | null {
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

function bindingRepresentation(
  expression: IdentifierExpression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Representation {
  const name = expression.text;
  const declaration = context.classes.declarationOf(expression, context);
  const binding = context.bindings.get(name);
  if (
    declaration &&
    (context.duplicateNames.has(name) || binding?.declaration !== declaration)
  ) {
    if (typeIsNullable(context.classes.typeOf(expression, context)))
      return "unknown";
    const declared = representationOfType(declaration.type);
    if (declared !== "unknown") return declared;
    const initializer = declaration.initializer;
    if (!initializer) return "unknown";
    const resolving = (context.resolvingTypeInitializers ??= new Set());
    if (resolving.has(initializer)) return "unknown";
    resolving.add(initializer);
    try {
      return expressionRepresentation(initializer, context, signatures);
    } finally {
      resolving.delete(initializer);
    }
  }
  if (!declaration) {
    if (context.parameters.has(name)) return context.parameters.get(name)!;
    const global = context.classes.globalDeclarationOf(expression, context);
    return global ? (context.globals?.get(global) ?? "unknown") : "unknown";
  }
  if (!binding) return "unknown";
  if (binding.decision !== "unknown") return binding.decision;
  return binding.declared === "unknown" ? binding.semantic : binding.declared;
}

export function expressionRepresentation(
  expression: Expression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Representation {
  if (expression instanceof ParenthesizedExpression) {
    return expressionRepresentation(expression.expression, context, signatures);
  }
  if (
    expression instanceof AssertionExpression &&
    expression.assertionKind === AssertionKind.NonNull
  ) {
    const asserted = representationOfType(
      context.classes.typeOf(expression.expression, context),
      true,
    );
    if (asserted !== "unknown") return asserted;
    return expressionRepresentation(expression.expression, context, signatures);
  }
  if (expression instanceof StringLiteralExpression) return "native";
  if (
    "literalKind" in expression &&
    expression.literalKind === LiteralKind.Template
  ) {
    return "native";
  }
  if (expression instanceof IdentifierExpression) {
    const representation = bindingRepresentation(
      expression,
      context,
      signatures,
    );
    const binding = context.bindings.get(expression.text);
    if (
      representation === "unknown" &&
      !context.duplicateNames.has(expression.text) &&
      binding?.candidate &&
      context.classes.declarationOf(expression, context) ===
        binding.declaration &&
      binding.declaration.initializer instanceof CallExpression
    ) {
      const property = propertyCall(binding.declaration.initializer);
      if (
        property &&
        !(
          property.expression instanceof IdentifierExpression &&
          property.expression.text === expression.text
        )
      ) {
        return expressionRepresentation(
          binding.declaration.initializer,
          context,
          signatures,
        );
      }
    }
    return representation !== "unknown"
      ? representation
      : representationOfType(context.classes.typeOf(expression, context));
  }
  if (expression instanceof PropertyAccessExpression) {
    const property = context.classes.propertyOf(expression, context);
    return property !== "unknown"
      ? property
      : representationOfType(context.classes.typeOf(expression, context));
  }
  if (expression instanceof ElementAccessExpression) {
    const type = context.classes.typeOf(expression, context);
    if (type) return representationOfType(type);
    return expression.expression instanceof IdentifierExpression
      ? (context.bindings.get(expression.expression.text)?.element ?? "unknown")
      : "unknown";
  }
  if (expression instanceof AssertionExpression) {
    const asserted = representationOfType(expression.toType);
    return asserted === "unknown"
      ? expressionRepresentation(expression.expression, context, signatures)
      : asserted;
  }
  if (expression instanceof TernaryExpression) {
    const left = expressionRepresentation(
      expression.ifThen,
      context,
      signatures,
    );
    const right = expressionRepresentation(
      expression.ifElse,
      context,
      signatures,
    );
    return left === right ? left : "unknown";
  }
  if (!(expression instanceof CallExpression)) return "unknown";
  if (calleeName(expression.expression) === "str") return "view";
  const property = propertyCall(expression);
  if (property) {
    if (
      property.expression instanceof IdentifierExpression &&
      ["pop", "shift", "at"].includes(property.property.text)
    ) {
      const element = context.bindings.get(property.expression.text)?.element;
      if (element && element !== "unknown") return element;
    }
    if (
      property.expression instanceof IdentifierExpression &&
      property.expression.text === "str"
    ) {
      if (
        property.property.text === "from" ||
        operationSemantics(property.property.text).result === "view"
      ) {
        return "view";
      }
      if (operationSemantics(property.property.text).result === "native") {
        return "native";
      }
    }
    const declared = declaredCallSignature(expression, context, signatures);
    if (declared) return declared.result;
    if (operationSemantics(property.property.text).result === "view") {
      return expressionRepresentation(property.expression, context, signatures);
    }
    if (operationSemantics(property.property.text).result === "native") {
      return expressionRepresentation(
        property.expression,
        context,
        signatures,
      ) === "unknown"
        ? "unknown"
        : "native";
    }
  }
  const signature =
    declaredCallSignature(expression, context, signatures) ??
    signatureForCall(expression, context, signatures);
  return signature?.result && signature.result !== "unknown"
    ? signature.result
    : representationOfType(context.classes.typeOf(expression, context));
}

export function recordOriginalViewReceivers(
  node: Node,
  context: FunctionContext,
  signatures: FunctionSignatures,
): void {
  context.originalViewReceivers ??= new Set();
  walk(node, (child) => {
    if (!(child instanceof CallExpression)) return;
    const property = propertyCall(child);
    if (
      property &&
      expressionRepresentation(property.expression, context, signatures) ===
        "view"
    )
      context.originalViewReceivers!.add(
        expressionRangeKey(property.expression),
      );
  });
}

function convertExpression(
  expression: Expression,
  expected: Representation,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Expression {
  if (expression instanceof NullExpression) return expression;

  if (
    expression instanceof PropertyAccessExpression &&
    expression.property.text === "length" &&
    expression.expression instanceof CallExpression
  ) {
    const call = expression.expression;
    const property = propertyCall(call);
    if (
      property &&
      operationSemantics(property.property.text).lengthFusible &&
      expressionRepresentation(
        isStrStaticCall(call) ? call.args[0] : property.expression,
        context,
        signatures,
      ) !== "unknown"
    ) {
      return rewriteExpression(
        lowerPackedLengthInitializer(call, context),
        expected,
        context,
        signatures,
      );
    }
  }

  if (expression instanceof CallExpression) {
    const property = propertyCall(expression);
    if (
      isStrStaticCall(expression) &&
      property?.property.text === "from" &&
      expression.args.length === 1
    ) {
      const argument = expression.args[0];
      if (expressionRepresentation(argument, context, signatures) === "view") {
        return convertExpression(argument, expected, context, signatures);
      }
      if (expected === "native") return argument;
    }

    if (
      property?.property.text === "toString" &&
      expression.args.length === 0 &&
      property.expression instanceof CallExpression
    ) {
      const receiver = property.expression;
      const receiverProperty = propertyCall(receiver);
      if (
        isStrStaticCall(receiver) &&
        receiverProperty?.property.text === "from" &&
        receiver.args.length === 1 &&
        expressionRepresentation(receiver.args[0], context, signatures) ===
          "native"
      ) {
        return convertExpression(
          receiver.args[0],
          expected,
          context,
          signatures,
        );
      }
    }
  }

  const actual = expressionRepresentation(expression, context, signatures);
  if (expected === "view" && actual === "native") {
    if (expression instanceof IdentifierExpression) {
      const binding = context.bindings.get(expression.text);
      if (binding) binding.conversions++;
    }
    return wrapAsView(expression);
  }
  if (expected === "view" && actual === "unknown") {
    return wrapUnknownAsView(expression);
  }
  if (expected === "native" && actual === "view") {
    if (expression instanceof IdentifierExpression) {
      const binding = context.bindings.get(expression.text);
      if (binding) binding.conversions++;
    }
    return materializeView(expression);
  }
  return expression;
}

function rewriteExpression(
  expression: Expression,
  expected: Representation,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Expression {
  if (
    expression instanceof PropertyAccessExpression &&
    expression.property.text === "length" &&
    expression.expression instanceof IdentifierExpression &&
    context.bindings.get(expression.expression.text)?.scalarizedLength &&
    context.classes.declarationOf(expression.expression, context) ===
      context.bindings.get(expression.expression.text)?.declaration
  ) {
    return expression.expression;
  }

  if (
    expression instanceof PropertyAccessExpression &&
    (expression.property.text === "length" ||
      expression.property.text === "isEmpty") &&
    expression.expression instanceof IdentifierExpression
  ) {
    const link = packedSpanLink(expression.expression, context);
    if (link) {
      return staticViewCall(
        expression.property.text === "length" ? "spanLength" : "isEmptySpan",
        spanOwnerExpression(link.owner, expression.range),
        [expression.expression],
      );
    }
  }

  if (expression instanceof ParenthesizedExpression) {
    expression.expression = rewriteExpression(
      expression.expression,
      expected,
      context,
      signatures,
    );
    return expression;
  }

  if (expression instanceof AssertionExpression) {
    expression.expression = rewriteExpression(
      expression.expression,
      "unknown",
      context,
      signatures,
    );
    return convertExpression(expression, expected, context, signatures);
  }

  if (expression instanceof TernaryExpression) {
    expression.condition = rewriteExpression(
      expression.condition,
      "unknown",
      context,
      signatures,
    );
    expression.ifThen = rewriteExpression(
      expression.ifThen,
      expected,
      context,
      signatures,
    );
    expression.ifElse = rewriteExpression(
      expression.ifElse,
      expected,
      context,
      signatures,
    );
    return expression;
  }

  if (expression instanceof BinaryExpression) {
    if (
      expression.operator === Token.Equals &&
      expression.left instanceof IdentifierExpression &&
      context.lowercaseSpans.has(expression.left.text) &&
      packedSpanLink(expression.left, context) &&
      expression.right instanceof CallExpression
    ) {
      const lower = propertyCall(expression.right);
      if (
        lower?.property.text === "toLowerCase" &&
        lower.expression instanceof IdentifierExpression &&
        lower.expression.text === expression.left.text
      ) {
        return expression.left;
      }
    }
    const equality =
      expression.operator === Token.Equals_Equals ||
      expression.operator === Token.Equals_Equals_Equals ||
      expression.operator === Token.Exclamation_Equals ||
      expression.operator === Token.Exclamation_Equals_Equals;
    if (equality) {
      const leftLink =
        expression.left instanceof IdentifierExpression
          ? packedSpanLink(expression.left, context)
          : null;
      const rightLink =
        expression.right instanceof IdentifierExpression
          ? packedSpanLink(expression.right, context)
          : null;
      const negate =
        expression.operator === Token.Exclamation_Equals ||
        expression.operator === Token.Exclamation_Equals_Equals;
      if (leftLink && rightLink) {
        return staticViewCall(
          negate ? "notEqualsSpanSpan" : "equalsSpanSpan",
          spanOwnerExpression(leftLink.owner, expression.range),
          [
            expression.left,
            spanOwnerExpression(rightLink.owner, expression.range),
            expression.right,
          ],
        );
      }
      const directView =
        expression.left instanceof CallExpression &&
        operationSemantics(propertyCall(expression.left)?.property.text ?? "")
          .spanProducing
          ? expression.left
          : expression.right instanceof CallExpression &&
              operationSemantics(
                propertyCall(expression.right)?.property.text ?? "",
              ).spanProducing
            ? expression.right
            : null;
      if (directView) {
        const parts = viewCallParts(directView);
        if (
          parts &&
          expressionRepresentation(parts.receiver, context, signatures) !==
            "unknown" &&
          // A span call evaluates its receiver and bounds before the other
          // operand. Preserve left-to-right evaluation for a right-hand view.
          (directView === expression.left ||
            expression.left instanceof StringLiteralExpression) &&
          // The owner is also passed to the comparison, so it must be safe
          // to read twice. Property accesses may invoke a getter each time.
          parts.receiver instanceof IdentifierExpression
        ) {
          const other =
            directView === expression.left ? expression.right : expression.left;
          const otherLink =
            directView === expression.left ? rightLink : leftLink;
          if (otherLink) {
            return staticViewCall(
              negate ? "notEqualsSpanSpan" : "equalsSpanSpan",
              parts.receiver,
              [
                lowerPackedSpanInitializer(directView, context),
                spanOwnerExpression(otherLink.owner, expression.range),
                other,
              ],
            );
          }
          return staticViewCall(
            expression.operator === Token.Exclamation_Equals ||
              expression.operator === Token.Exclamation_Equals_Equals
              ? "notEqualsSpan"
              : "equalsSpan",
            parts.receiver,
            [
              lowerPackedSpanInitializer(directView, context),
              rewriteExpression(other, "unknown", context, signatures),
            ],
          );
        }
      }
      const spanExpression = leftLink
        ? expression.left
        : rightLink
          ? expression.right
          : null;
      const spanLink = leftLink ?? rightLink;
      if (spanExpression instanceof IdentifierExpression && spanLink) {
        const other =
          spanExpression === expression.left
            ? expression.right
            : expression.left;
        const lowercase =
          context.lowercaseSpans.has(spanExpression.text) &&
          other instanceof StringLiteralExpression;
        return staticViewCall(
          expression.operator === Token.Exclamation_Equals ||
            expression.operator === Token.Exclamation_Equals_Equals
            ? lowercase
              ? "notEqualsLowerCaseSpan"
              : "notEqualsSpan"
            : lowercase
              ? "equalsLowerCaseSpan"
              : "equalsSpan",
          spanOwnerExpression(spanLink.owner, expression.range),
          [
            spanExpression,
            rewriteExpression(other, "unknown", context, signatures),
          ],
        );
      }
      const leftRepresentation = expressionRepresentation(
        expression.left,
        context,
        signatures,
      );
      const rightRepresentation = expressionRepresentation(
        expression.right,
        context,
        signatures,
      );
      if (leftRepresentation === "view" || rightRepresentation === "view") {
        expression.left = rewriteExpression(
          expression.left,
          "view",
          context,
          signatures,
        );
        expression.right = rewriteExpression(
          expression.right,
          "view",
          context,
          signatures,
        );
        return expression;
      }
    }
    if (expression.operator === Token.Equals) {
      let target: Representation = "unknown";
      if (expression.left instanceof IdentifierExpression) {
        target = bindingRepresentation(expression.left, context, signatures);
      } else if (expression.left instanceof PropertyAccessExpression) {
        target = context.classes.propertyOf(expression.left, context);
      } else if (expression.left instanceof ElementAccessExpression) {
        target = expressionRepresentation(expression.left, context, signatures);
      }
      expression.left = rewriteExpression(
        expression.left,
        "unknown",
        context,
        signatures,
      );
      expression.right = rewriteExpression(
        expression.right,
        target,
        context,
        signatures,
      );
    } else {
      expression.left = rewriteExpression(
        expression.left,
        "unknown",
        context,
        signatures,
      );
      expression.right = rewriteExpression(
        expression.right,
        "unknown",
        context,
        signatures,
      );
    }
    return convertExpression(expression, expected, context, signatures);
  }

  if (expression instanceof CallExpression) {
    if (isStrStaticCall(expression)) {
      const staticMethod = propertyCall(expression)?.property.text ?? "";
      expression.args = expression.args.map((argument, index) =>
        rewriteExpression(
          argument,
          index === 0 &&
            staticMethod.endsWith("Length") &&
            expressionCanProduceView(argument)
            ? "view"
            : "unknown",
          context,
          signatures,
        ),
      );
      return convertExpression(expression, expected, context, signatures);
    }
    const property = propertyCall(expression);
    if (property) {
      const method = property.property.text;
      const callbackType = declaredCallType(expression, context);
      const methodSignature = declaredCallSignature(
        expression,
        context,
        signatures,
      );
      const originalReceiverRepresentation = expressionRepresentation(
        property.expression,
        context,
        signatures,
      );
      const nativeBoundsMethod =
        method === "repeat" || method === "padStart" || method === "padEnd";
      const explicitViewReceiver =
        nativeBoundsMethod &&
        context.originalViewReceivers?.has(
          expressionRangeKey(property.expression),
        );
      const spanLink =
        property.expression instanceof IdentifierExpression
          ? packedSpanLink(property.expression, context)
          : null;
      if (spanLink && operationSemantics(method).spanScalar) {
        const args = expression.args.map((argument) =>
          rewriteExpression(argument, "unknown", context, signatures),
        );
        const positionedIncludes = method === "includes" && args.length > 1;
        const call = staticViewCall(
          positionedIncludes ? "indexOfSpan" : `${method}Span`,
          spanOwnerExpression(spanLink.owner, expression.range),
          [property.expression, ...args],
        );
        return convertExpression(
          positionedIncludes ? foundIndex(call) : call,
          expected,
          context,
          signatures,
        );
      }
      const positionedIncludes =
        method === "includes" &&
        expression.args.length > 1 &&
        originalReceiverRepresentation !== "unknown";
      const nativeViewNeedle =
        originalReceiverRepresentation === "native" &&
        VIEW_NEEDLE_SEARCH.has(method) &&
        expression.args[0] &&
        expressionRepresentation(expression.args[0], context, signatures) ===
          "view";
      const viewComparison =
        method === "localeCompare" &&
        expression.args.length === 1 &&
        originalReceiverRepresentation !== "unknown" &&
        (originalReceiverRepresentation === "view" ||
          expressionCanProduceView(property.expression) ||
          expressionRepresentation(expression.args[0], context, signatures) ===
            "view");
      if (positionedIncludes || nativeViewNeedle || viewComparison) {
        const receiver = rewriteExpression(
          property.expression,
          originalReceiverRepresentation === "native" &&
            expressionCanProduceView(property.expression)
            ? "view"
            : originalReceiverRepresentation,
          context,
          signatures,
        );
        const args = expression.args.map((argument) =>
          rewriteExpression(argument, "unknown", context, signatures),
        );
        const call = staticViewCall(
          positionedIncludes ? "indexOf" : viewComparison ? "compare" : method,
          receiver,
          args,
        );
        return convertExpression(
          positionedIncludes ? foundIndex(call) : call,
          expected,
          context,
          signatures,
        );
      }
      const containerType = context.classes.typeOf(
        property.expression,
        context,
      );
      const containerElement = containerType
        ? elementRepresentationOfType(containerType)
        : property.expression instanceof IdentifierExpression
          ? (context.bindings.get(property.expression.text)?.element ??
            "unknown")
          : "unknown";
      let receiverExpected: Representation = "unknown";
      if (
        expressionRepresentation(property.expression, context, signatures) !==
          "unknown" &&
        expressionCanProduceView(property.expression) &&
        (operationSemantics(method).result === "scalar" ||
          (operationSemantics(method).result === "view" && expected === "view"))
      ) {
        receiverExpected = "view";
      }
      property.expression = rewriteExpression(
        property.expression,
        receiverExpected,
        context,
        signatures,
      );
      expression.args = expression.args.map((argument, index) => {
        const containerArgument = containerArgumentKind(method, index);
        return rewriteExpression(
          argument,
          methodSignature
            ? (methodSignature.parameters[index] ?? "unknown")
            : callbackType
              ? representationOfType(callArgumentType(callbackType, index))
              : containerArgument
                ? containerArgument === "element"
                  ? containerElement
                  : "unknown"
                : operationSemantics(method).result !== "unknown"
                  ? "unknown"
                  : (signatureForCall(expression, context, signatures)
                      ?.parameters[index] ?? "unknown"),
          context,
          signatures,
        );
      });

      if (
        nativeBoundsMethod &&
        !explicitViewReceiver &&
        originalReceiverRepresentation !== "unknown" &&
        expressionRepresentation(property.expression, context, signatures) ===
          "view"
      ) {
        return convertExpression(
          staticViewCall(
            `${method}Native`,
            property.expression,
            expression.args,
          ),
          expected,
          context,
          signatures,
        );
      }

      if (
        method === "toLowerCase" &&
        !context.representationSensitive &&
        originalReceiverRepresentation === "view"
      ) {
        return convertExpression(
          staticViewCall(
            "toLowerCaseIfNeeded",
            property.expression,
            expression.args,
          ),
          expected,
          context,
          signatures,
        );
      }

      if (
        method === "at" &&
        !context.originalViewReceivers?.has(
          expressionRangeKey(property.expression),
        ) &&
        (originalReceiverRepresentation === "view" ||
          (originalReceiverRepresentation === "native" && expected === "view"))
      ) {
        return convertExpression(
          staticViewCall("atNative", property.expression, expression.args),
          expected,
          context,
          signatures,
        );
      }

      if (operationSemantics(method).result === "view" && expected === "view") {
        const receiverRep = expressionRepresentation(
          property.expression,
          context,
          signatures,
        );
        if (receiverRep === "native") {
          return staticViewCall(method, property.expression, expression.args);
        }
      }
    } else {
      const signature =
        declaredCallSignature(expression, context, signatures) ??
        signatureForCall(expression, context, signatures);
      const callbackType = declaredCallType(expression, context);
      const rewrittenArgs: Expression[] = [];
      expression.args.forEach((argument, index) => {
        if (
          signature?.callable &&
          signature.spanParameters.has(index) &&
          argument instanceof CallExpression
        ) {
          const parts = viewCallParts(argument);
          if (parts && operationSemantics(parts.method).spanProducing) {
            const range = argument.range;
            const temporaries = (context.temporaryOwners ??= []);
            let name = `__as_str_captured_owner_${temporaries.length}`;
            while (
              range.source.text.includes(name) ||
              context.bindings.has(name) ||
              context.parameters.has(name)
            )
              name += "_";
            const owner = () => identifier(name, range);
            temporaries.push(
              Node.createVariableStatement(
                null,
                [
                  Node.createVariableDeclaration(
                    owner(),
                    null,
                    CommonFlags.Let,
                    Node.createNamedType(
                      Node.createSimpleTypeName("string", range),
                      null,
                      false,
                      range,
                    ),
                    Node.createStringLiteralExpression("", range),
                    range,
                  ),
                ],
                range,
              ),
            );
            const capture = Node.createBinaryExpression(
              Token.Equals,
              owner(),
              rewriteExpression(parts.receiver, "native", context, signatures),
              range,
            );
            const span = staticViewCall(
              `${operationSemantics(parts.method).normalizedSpanName}Span`,
              owner(),
              parts.args,
            );
            rewrittenArgs.push(
              Node.createCommaExpression(
                [
                  capture,
                  rewriteExpression(span, "unknown", context, signatures),
                ],
                range,
              ),
              owner(),
            );
            return;
          }
        }
        rewrittenArgs.push(
          rewriteExpression(
            argument,
            signature?.callable
              ? (signature.parameters[index] ?? "unknown")
              : representationOfType(callArgumentType(callbackType, index)),
            context,
            signatures,
          ),
        );
      });
      expression.args = rewrittenArgs;
    }
    return convertExpression(expression, expected, context, signatures);
  }

  if (expression instanceof PropertyAccessExpression) {
    const receiverExpected =
      operationSemantics(expression.property.text).result === "scalar" &&
      expressionCanProduceView(expression.expression) &&
      expressionRepresentation(expression.expression, context, signatures) !==
        "unknown"
        ? "view"
        : "unknown";
    expression.expression = rewriteExpression(
      expression.expression,
      receiverExpected,
      context,
      signatures,
    );
    return convertExpression(expression, expected, context, signatures);
  }

  if (expression instanceof ElementAccessExpression) {
    expression.expression = rewriteExpression(
      expression.expression,
      expressionCanProduceView(expression.expression) &&
        expressionRepresentation(expression.expression, context, signatures) !==
          "unknown"
        ? "view"
        : "unknown",
      context,
      signatures,
    );
    expression.elementExpression = rewriteExpression(
      expression.elementExpression,
      "unknown",
      context,
      signatures,
    );
    return convertExpression(expression, expected, context, signatures);
  }

  if (expression instanceof CommaExpression) {
    expression.expressions = expression.expressions.map((item, index) =>
      rewriteExpression(
        item,
        index === expression.expressions.length - 1 ? expected : "unknown",
        context,
        signatures,
      ),
    );
    return expression;
  }

  if (
    expression instanceof UnaryPrefixExpression ||
    expression instanceof UnaryPostfixExpression
  ) {
    expression.operand = rewriteExpression(
      expression.operand,
      "unknown",
      context,
      signatures,
    );
    return convertExpression(expression, expected, context, signatures);
  }

  // Keep traversal aligned with planning, including constructor arguments,
  // array/object literals, and template substitutions. Each child expression
  // owns its recursive rewrite; declarations and types are separate scopes.
  walk(expression, (node, ref): boolean | void => {
    if (node === expression) return;
    if (!(node instanceof Expression) || ref.key === "names") return false;
    const rewritten = rewriteExpression(node, "unknown", context, signatures);
    const parent = ref.parent as unknown as Record<string, unknown>;
    const value = parent[ref.key!];
    if (Array.isArray(value)) value[value.indexOf(node)] = rewritten;
    else parent[ref.key!] = rewritten;
    return false;
  });
  return convertExpression(expression, expected, context, signatures);
}

export function rewriteStatement(
  statement: Statement,
  context: FunctionContext,
  signatures: FunctionSignatures,
): void {
  if (statement instanceof BlockStatement) {
    for (const child of statement.statements) {
      rewriteStatement(child, context, signatures);
    }
    return;
  }
  if (statement instanceof VariableStatement) {
    for (const declaration of statement.declarations) {
      const binding = context.duplicateNames.has(declaration.name.text)
        ? undefined
        : context.bindings.get(declaration.name.text);
      if (
        binding?.scalarizedLength &&
        declaration.initializer instanceof CallExpression
      ) {
        declaration.type = i32Type(declaration.range);
        declaration.initializer = rewriteExpression(
          lowerPackedLengthInitializer(declaration.initializer, context),
          "unknown",
          context,
          signatures,
        );
        continue;
      }
      if (
        binding?.scalarizedSpan &&
        declaration.initializer instanceof CallExpression
      ) {
        declaration.type = u64Type(declaration.range);
        declaration.initializer = rewriteExpression(
          lowerPackedSpanInitializer(declaration.initializer, context),
          "unknown",
          context,
          signatures,
        );
        continue;
      }
      const expected =
        binding?.decision ?? representationOfType(declaration.type);
      if (binding?.candidate && binding.decision === "view") {
        declaration.type = viewType(declaration.range);
      }
      if (declaration.initializer) {
        declaration.initializer = rewriteExpression(
          declaration.initializer,
          expected,
          context,
          signatures,
        );
      }
    }
    return;
  }
  if (statement instanceof ExpressionStatement) {
    statement.expression = rewriteExpression(
      statement.expression,
      "unknown",
      context,
      signatures,
    );
    return;
  }
  if (statement instanceof ReturnStatement) {
    if (statement.value) {
      statement.value = rewriteExpression(
        statement.value,
        context.declaration
          ? representationOfType(context.declaration.signature.returnType)
          : "unknown",
        context,
        signatures,
      );
    }
    return;
  }
  if (statement instanceof IfStatement) {
    statement.condition = rewriteExpression(
      statement.condition,
      "unknown",
      context,
      signatures,
    );
    rewriteStatement(statement.ifTrue, context, signatures);
    if (statement.ifFalse)
      rewriteStatement(statement.ifFalse, context, signatures);
    return;
  }
  if (statement instanceof WhileStatement || statement instanceof DoStatement) {
    statement.condition = rewriteExpression(
      statement.condition,
      "unknown",
      context,
      signatures,
    );
    rewriteStatement(statement.body, context, signatures);
    return;
  }
  if (statement instanceof ForStatement) {
    if (statement.initializer)
      rewriteStatement(statement.initializer, context, signatures);
    if (statement.condition) {
      statement.condition = rewriteExpression(
        statement.condition,
        "unknown",
        context,
        signatures,
      );
    }
    if (statement.incrementor) {
      statement.incrementor = rewriteExpression(
        statement.incrementor,
        "unknown",
        context,
        signatures,
      );
    }
    rewriteStatement(statement.body, context, signatures);
    return;
  }
  if (statement instanceof ForOfStatement) {
    rewriteStatement(statement.variable, context, signatures);
    statement.iterable = rewriteExpression(
      statement.iterable,
      "unknown",
      context,
      signatures,
    );
    rewriteStatement(statement.body, context, signatures);
    return;
  }
  if (statement instanceof SwitchStatement) {
    statement.condition = rewriteExpression(
      statement.condition,
      "unknown",
      context,
      signatures,
    );
    for (const switchCase of statement.cases) {
      if (switchCase.label) {
        switchCase.label = rewriteExpression(
          switchCase.label,
          "unknown",
          context,
          signatures,
        );
      }
      for (const child of switchCase.statements) {
        rewriteStatement(child, context, signatures);
      }
    }
    return;
  }
  if (statement instanceof ThrowStatement) {
    statement.value = rewriteExpression(
      statement.value,
      "unknown",
      context,
      signatures,
    );
    return;
  }
  if (statement instanceof TryStatement) {
    for (const child of statement.bodyStatements) {
      rewriteStatement(child, context, signatures);
    }
    for (const child of statement.catchStatements ?? []) {
      rewriteStatement(child, context, signatures);
    }
    for (const child of statement.finallyStatements ?? []) {
      rewriteStatement(child, context, signatures);
    }
  }
}

export function rewriteDeclarationBoundaries(
  statements: Statement[],
  context: FunctionContext,
  signatures: FunctionSignatures,
): void {
  for (const statement of statements) {
    if (statement instanceof VariableStatement) {
      for (const declaration of statement.declarations) {
        if (!declaration.initializer) continue;
        recordOriginalViewReceivers(
          declaration.initializer,
          context,
          signatures,
        );
        declaration.initializer = rewriteExpression(
          declaration.initializer,
          representationOfType(declaration.type),
          context,
          signatures,
        );
      }
      continue;
    }
    if (statement instanceof ClassDeclaration) {
      for (const member of statement.members) {
        if (!(member instanceof FieldDeclaration) || !member.initializer)
          continue;
        const fieldContext: FunctionContext = {
          ...context,
          className: context.classes.ownerOf(statement),
          originalViewReceivers: new Set(context.originalViewReceivers),
        };
        recordOriginalViewReceivers(
          member.initializer,
          fieldContext,
          signatures,
        );
        member.initializer = rewriteExpression(
          member.initializer,
          representationOfType(member.type),
          fieldContext,
          signatures,
        );
      }
      continue;
    }
    if (statement instanceof NamespaceDeclaration) {
      rewriteDeclarationBoundaries(statement.members, context, signatures);
    }
  }
}
