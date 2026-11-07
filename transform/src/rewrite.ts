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
  VoidStatement,
  WhileStatement,
} from "assemblyscript/dist/assemblyscript.js";
import {
  materializeView,
  elementRepresentationOfType,
  expressionRangeKey,
  identifier,
  parseExpression,
  i32Type,
  integer,
  loweredSpanCalls,
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
  isSpanCall,
  isSpanLink,
  spanChainOwner,
  spanChainRoot,
  spanLinkReceiver,
  spanOwnerExpression,
  spanReturnCall,
  spanTernary,
  splitField,
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
      ? (context.classes.bindingOf(expression.expression, context)?.element ??
          "unknown")
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
      const element = context.classes.bindingOf(
        property.expression,
        context,
      )?.element;
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

  if (expression instanceof PropertyAccessExpression) {
    const length = fusedLength(expression, context, signatures);
    if (length) return rewriteExpression(length, expected, context, signatures);
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

const loweredReturns = new WeakSet<ReturnStatement>();

/** A local already lowered to a packed span. */
function packedRoot(expression: Expression, context: FunctionContext): boolean {
  return (
    expression instanceof IdentifierExpression &&
    !!context.classes.bindingOf(expression, context)?.scalarizedSpan
  );
}

/** The owner of a chain rooted at a string a span may read in place. */
function scalarChainOwner(
  chain: Expression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Expression | null {
  const root = spanChainRoot(chain);
  if (
    !(
      root instanceof IdentifierExpression ||
      root instanceof StringLiteralExpression
    ) ||
    expressionRepresentation(root, context, signatures) === "unknown"
  )
    return null;
  return spanChainOwner(chain, context);
}

/** `.length` of a view-producing chain, read without materializing a link. */
function fusedLength(
  expression: PropertyAccessExpression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Expression | null {
  if (context.representationSensitive || expression.property.text !== "length")
    return null;
  const fused = fuseScalarLength(expression.expression, context, signatures);
  if (fused) return fused;
  const call = expression.expression;
  if (!(call instanceof CallExpression)) return null;
  const property = propertyCall(call);
  if (
    !property ||
    !operationSemantics(property.property.text).lengthFusible ||
    expressionRepresentation(
      spanChainRoot(isStrStaticCall(call) ? call.args[0] : property.expression),
      context,
      signatures,
    ) === "unknown"
  )
    return null;
  return lowerPackedLengthInitializer(call, context);
}

/**
 * `.length` of a split field, or of the array a split returns, reads the
 * receiver in place instead of allocating the array and its fields.
 */
function fuseScalarLength(
  value: Expression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Expression | null {
  if (
    splitField(value) ||
    (spanReturnCall(value) && !loweredSpanCalls.has(value))
  ) {
    const owner = scalarChainOwner(value, context, signatures);
    return owner
      ? staticViewCall("spanLength", owner, [
          lowerPackedSpanInitializer(value, context),
        ])
      : null;
  }
  if (!(value instanceof CallExpression) || isStrStaticCall(value)) return null;
  const property = propertyCall(value);
  const separator = value.args[0];
  if (
    property?.property.text !== "split" ||
    value.args.length !== 1 ||
    !(separator instanceof StringLiteralExpression) ||
    !separator.value.length
  )
    return null;
  const receiver = property.expression;
  if (
    isSpanLink(receiver) ||
    (receiver instanceof IdentifierExpression &&
      context.classes.bindingOf(receiver, context)?.scalarizedSpan)
  ) {
    const owner = scalarChainOwner(receiver, context, signatures);
    return owner
      ? staticViewCall("splitCountSpan", owner, [
          isSpanLink(receiver)
            ? lowerPackedSpanInitializer(receiver, context)
            : receiver,
          separator,
        ])
      : null;
  }
  const representation = expressionRepresentation(
    receiver,
    context,
    signatures,
  );
  return representation === "native" || representation === "view"
    ? staticViewCall("splitCount", receiver, [separator])
    : null;
}

/**
 * A module constant holding a switch's literal labels, so selecting a case
 * allocates nothing. Without a module scope, the literal is passed inline.
 */
function caseLabels(
  labels: StringLiteralExpression[],
  range: Expression["range"],
  context: FunctionContext,
): Expression {
  const array = Node.createArrayLiteralExpression(labels, range);
  const constants = context.moduleConstants;
  if (!constants) return array;
  const declared = new Set([
    ...constants.map((statement) => statement.declarations[0].name.text),
    ...[...(context.globals?.keys() ?? [])].map(
      (declaration) => declaration.name.text,
    ),
  ]);
  let name = `__as_str_case_labels_${constants.length}`;
  while (range.source.text.includes(name) || declared.has(name)) name += "_";
  constants.push(
    Node.createVariableStatement(
      null,
      [
        Node.createVariableDeclaration(
          identifier(name, range),
          null,
          CommonFlags.Const,
          Node.createNamedType(
            Node.createSimpleTypeName("StaticArray", range),
            [
              Node.createNamedType(
                Node.createSimpleTypeName("string", range),
                null,
                false,
                range,
              ),
            ],
            false,
            range,
          ),
          array,
          range,
        ),
      ],
      range,
    ),
  );
  return identifier(name, range);
}

interface ConcatOperand {
  owner: Expression | null;
  value: Expression;
}

/** A concatenation operand: a span of a native string, or a native string. */
function concatOperand(
  expression: Expression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): ConcatOperand | null {
  if (
    (isSpanLink(expression) || spanTernary(expression)) &&
    !(spanReturnCall(expression) && loweredSpanCalls.has(expression))
  ) {
    const root = spanChainRoot(expression);
    const native =
      packedRoot(root, context) ||
      ((root instanceof IdentifierExpression ||
        root instanceof StringLiteralExpression) &&
        expressionRepresentation(root, context, signatures) === "native");
    const owner = native ? spanChainOwner(expression, context) : null;
    return owner
      ? { owner, value: lowerPackedSpanInitializer(expression, context) }
      : null;
  }
  // A concatenation of strings and spans is itself a native string.
  const nested =
    expression instanceof BinaryExpression &&
    expression.operator === Token.Plus &&
    !!concatOperand(expression.left, context, signatures) &&
    !!concatOperand(expression.right, context, signatures);
  return nested ||
    expressionRepresentation(expression, context, signatures) === "native"
    ? { owner: null, value: expression }
    : null;
}

/**
 * `a.trim() + "="` copies the trimmed string and then both operands. Reading
 * a span operand in place copies each byte once.
 */
function fuseConcat(
  expression: BinaryExpression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Expression | null {
  const left = concatOperand(expression.left, context, signatures);
  const right = left && concatOperand(expression.right, context, signatures);
  if (!left || !right || (!left.owner && !right.owner)) return null;
  if (left.owner && right.owner)
    return staticViewCall("concatSpans", left.owner, [
      left.value,
      right.owner,
      right.value,
    ]);
  return left.owner
    ? staticViewCall("concatSpanString", left.owner, [left.value, right.value])
    : staticViewCall("concatStringSpan", left.value, [
        right.owner!,
        right.value,
      ]);
}

const SPAN_CASE_CONVERSIONS = new Set(["toLowerCase", "toUpperCase"]);

/**
 * A native chain of span operations copies its string at every link. When its
 * result must be native anyway, narrow one span and copy it once at the end.
 */
function fuseNativeChain(
  expression: Expression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Expression | null {
  let chain: Expression;
  let conversion: string | null = null;
  const returned = spanReturnCall(expression);
  if (returned) {
    // Lowered calls already sit in a span position.
    if (loweredSpanCalls.has(returned)) return null;
    chain = returned;
  } else if (splitField(expression)) {
    // Native split allocates an array and every field to read one of them.
    chain = expression;
  } else if (
    expression instanceof CallExpression &&
    !isStrStaticCall(expression)
  ) {
    const parts = viewCallParts(expression);
    if (
      !parts ||
      !(isSpanLink(parts.receiver) || packedRoot(parts.receiver, context))
    )
      return null;
    if (SPAN_CASE_CONVERSIONS.has(parts.method) && !parts.args.length) {
      conversion = parts.method;
      chain = parts.receiver;
    } else if (operationSemantics(parts.method).spanProducing) {
      chain = expression;
    } else return null;
  } else return null;
  const root = spanChainRoot(chain);
  if (
    !packedRoot(root, context) &&
    (!(
      root instanceof IdentifierExpression ||
      root instanceof StringLiteralExpression
    ) ||
      expressionRepresentation(root, context, signatures) !== "native")
  )
    return null;
  const owner = spanChainOwner(chain, context);
  if (!owner) return null;
  return staticViewCall(
    conversion ? `${conversion}Span` : "spanToString",
    owner,
    [lowerPackedSpanInitializer(chain, context)],
  );
}

function rewriteExpression(
  expression: Expression,
  expected: Representation,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Expression {
  // Native substrings are snapshots. A caller that can observe or mutate raw
  // memory must evaluate the native operation before wrapping its result.
  if (
    context.representationSensitive &&
    expected === "view" &&
    expressionRepresentation(expression, context, signatures) === "native"
  ) {
    return wrapAsView(
      rewriteExpression(expression, "native", context, signatures),
    );
  }

  if (
    expected !== "view" &&
    !context.representationSensitive &&
    (expression instanceof CallExpression ||
      expression instanceof ElementAccessExpression)
  ) {
    const fused = fuseNativeChain(expression, context, signatures);
    if (fused) return rewriteExpression(fused, expected, context, signatures);
  }

  // A view of a split field or of a chain needs one object, not one per link.
  if (
    expected === "view" &&
    !context.representationSensitive &&
    (splitField(expression) ||
      (spanReturnCall(expression) && !loweredSpanCalls.has(expression)) ||
      (isSpanCall(expression) &&
        (isSpanLink(spanLinkReceiver(expression)!) ||
          packedRoot(spanLinkReceiver(expression)!, context))))
  ) {
    const owner = scalarChainOwner(expression, context, signatures);
    if (owner)
      return rewriteExpression(
        staticViewCall("fromSpan", owner, [
          lowerPackedSpanInitializer(expression, context),
        ]),
        "unknown",
        context,
        signatures,
      );
  }

  if (
    expression instanceof PropertyAccessExpression &&
    expression.property.text === "length" &&
    expression.expression instanceof IdentifierExpression &&
    context.classes.bindingOf(expression.expression, context)?.scalarizedLength
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
      expression.operator === Token.Plus &&
      expected !== "view" &&
      !context.representationSensitive
    ) {
      const fused = fuseConcat(expression, context, signatures);
      if (fused) return rewriteExpression(fused, expected, context, signatures);
    }
    // `out += span` appends the span's bytes; `out` is read before the span,
    // as the compound assignment reads it.
    if (
      expression.operator === Token.Plus_Equals &&
      !context.representationSensitive &&
      expression.left instanceof IdentifierExpression &&
      expressionRepresentation(expression.left, context, signatures) ===
        "native"
    ) {
      const right = concatOperand(expression.right, context, signatures);
      if (right?.owner)
        return rewriteExpression(
          Node.createBinaryExpression(
            Token.Equals,
            expression.left,
            staticViewCall(
              "concatStringSpan",
              identifier(expression.left.text, expression.left.range),
              [right.owner, right.value],
            ),
            expression.range,
          ),
          expected,
          context,
          signatures,
        );
    }
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
    if (
      expression.operator === Token.Equals &&
      expression.left instanceof IdentifierExpression &&
      expression.right instanceof CallExpression &&
      context.classes.bindingOf(expression.left, context)?.scalarizedSpan
    ) {
      // The analysis admitted only chains over the binding's own owner.
      expression.right = rewriteExpression(
        lowerPackedSpanInitializer(expression.right, context),
        "unknown",
        context,
        signatures,
      );
      return expression;
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
      const directView = isSpanLink(expression.left)
        ? expression.left
        : isSpanLink(expression.right)
          ? expression.right
          : null;
      if (directView && !context.representationSensitive) {
        const root = spanChainRoot(directView);
        const owner =
          // The owner is also passed to the comparison, so it must be safe
          // to read twice. Property accesses may invoke a getter each time.
          root instanceof IdentifierExpression
            ? spanChainOwner(directView, context)
            : null;
        if (
          owner &&
          expressionRepresentation(root, context, signatures) !== "unknown" &&
          // A span call evaluates its receiver and bounds before the other
          // operand. Preserve left-to-right evaluation for a right-hand view.
          (directView === expression.left ||
            expression.left instanceof StringLiteralExpression)
        ) {
          const other =
            directView === expression.left ? expression.right : expression.left;
          const otherLink =
            directView === expression.left ? rightLink : leftLink;
          if (otherLink) {
            return staticViewCall(
              negate ? "notEqualsSpanSpan" : "equalsSpanSpan",
              owner,
              [
                lowerPackedSpanInitializer(directView, context),
                spanOwnerExpression(otherLink.owner, expression.range),
                other,
              ],
            );
          }
          // Both operands chains of known strings: compare two spans.
          const otherOwner = isSpanLink(other)
            ? scalarChainOwner(other, context, signatures)
            : null;
          if (otherOwner)
            return staticViewCall(
              negate ? "notEqualsSpanSpan" : "equalsSpanSpan",
              owner,
              [
                lowerPackedSpanInitializer(directView, context),
                otherOwner,
                lowerPackedSpanInitializer(other, context),
              ],
            );
          return staticViewCall(
            expression.operator === Token.Exclamation_Equals ||
              expression.operator === Token.Exclamation_Equals_Equals
              ? "notEqualsSpan"
              : "equalsSpan",
            owner,
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
      const chainOwner =
        operationSemantics(method).spanScalar &&
        !context.representationSensitive &&
        isSpanLink(property.expression)
          ? scalarChainOwner(property.expression, context, signatures)
          : null;
      if (chainOwner) {
        // Query one span of the chain's root instead of copying every link.
        const positionedIncludes =
          method === "includes" && expression.args.length > 1;
        const call = staticViewCall(
          positionedIncludes ? "indexOfSpan" : `${method}Span`,
          chainOwner,
          [
            lowerPackedSpanInitializer(property.expression, context),
            ...expression.args,
          ],
        );
        return rewriteExpression(
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
          ? (context.classes.bindingOf(property.expression, context)?.element ??
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
      // Resolve the original signature before rewriting the callee. Function
      // results and indexed callbacks can themselves contain promoted calls.
      expression.expression = rewriteExpression(
        expression.expression,
        "unknown",
        context,
        signatures,
      );
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
            // Captures outside a block body are module globals. A distinct
            // prefix keeps them from aliasing an enclosing function's locals.
            const moduleScope = !(
              context.declaration?.body instanceof BlockStatement
            );
            // Module captures from an earlier optimization round are already
            // globals, while this round's list starts empty.
            const declared = new Set([
              ...temporaries.map(
                (statement) => statement.declarations[0].name.text,
              ),
              ...[...(context.globals?.keys() ?? [])].map(
                (declaration) => declaration.name.text,
              ),
            ]);
            let name = `__as_str_${moduleScope ? "module" : "captured"}_owner_${temporaries.length}`;
            while (
              range.source.text.includes(name) ||
              declared.has(name) ||
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
              rewriteExpression(
                context.representationSensitive ? argument : parts.receiver,
                "native",
                context,
                signatures,
              ),
              range,
            );
            const span = staticViewCall(
              context.representationSensitive
                ? "sliceSpan"
                : `${operationSemantics(parts.method).normalizedSpanName}Span`,
              owner(),
              context.representationSensitive ? [] : parts.args,
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
    // Fuse a length before its receiver is rewritten into a view object.
    const length = fusedLength(expression, context, signatures);
    if (length) return rewriteExpression(length, expected, context, signatures);
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
        (isSpanLink(declaration.initializer!) ||
          spanTernary(declaration.initializer!))
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
  if (
    statement instanceof ExpressionStatement ||
    statement instanceof VoidStatement
  ) {
    statement.expression = rewriteExpression(
      statement.expression,
      "unknown",
      context,
      signatures,
    );
    return;
  }
  if (statement instanceof ReturnStatement) {
    // A span-returning function returns the packed span of its argument.
    // Rewriting is repeated per round, so each return is lowered once.
    if (statement.value && context.spanReturn !== undefined) {
      if (loweredReturns.has(statement)) return;
      loweredReturns.add(statement);
      statement.value = rewriteExpression(
        lowerPackedSpanInitializer(statement.value, context),
        "unknown",
        context,
        signatures,
      );
      return;
    }
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
    // A switch over a span chain with literal labels selects a case by index,
    // comparing one span with each label instead of copying the chain.
    const labels = statement.cases.map((switchCase) => switchCase.label);
    const owner =
      !context.representationSensitive &&
      isSpanLink(statement.condition) &&
      labels.every(
        (label) => label === null || label instanceof StringLiteralExpression,
      )
        ? scalarChainOwner(statement.condition, context, signatures)
        : null;
    if (owner) {
      const range = statement.condition.range;
      const literals = labels.filter(
        (label): label is StringLiteralExpression => label !== null,
      );
      statement.condition = rewriteExpression(
        staticViewCall("caseIndexSpan", owner, [
          lowerPackedSpanInitializer(statement.condition, context),
          caseLabels(literals, range, context),
        ]),
        "unknown",
        context,
        signatures,
      );
      let index = 0;
      for (const switchCase of statement.cases)
        if (switchCase.label)
          switchCase.label = integer(index++, switchCase.label);
    } else {
      statement.condition = rewriteExpression(
        statement.condition,
        "unknown",
        context,
        signatures,
      );
    }
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
      continue;
    }
    // Module initialization can contain calls and control flow as well as
    // declarations. These call sites must follow promoted helper signatures.
    rewriteStatement(statement, context, signatures);
  }
}
