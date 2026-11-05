import {
  callArgumentType,
  classDeclarationOfType,
  typeIsNullable,
} from "./type-resolution.js";
import {
  FunctionSignatures,
  declaredCallSignature,
  declaredCallType,
  signatureForCall,
  signatureForDeclaration,
} from "./signatures.js";
import { SourceClassTypes } from "./class-types.js";
import {
  AssertionExpression,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ClassDeclaration,
  CommaExpression,
  CommonFlags,
  DecoratorNode,
  ElementAccessExpression,
  Expression,
  ExpressionStatement,
  FieldDeclaration,
  FunctionDeclaration,
  FunctionExpression,
  FunctionTypeNode,
  IdentifierExpression,
  NewExpression,
  Node,
  NamespaceDeclaration,
  ParenthesizedExpression,
  ParameterKind,
  PropertyAccessExpression,
  ReturnStatement,
  Source,
  Statement,
  TernaryExpression,
  ThrowStatement,
  Token,
  StringLiteralExpression,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import {
  elementRepresentationOfType,
  Representation,
  representationOfType,
  viewType,
} from "./ast.js";
import { containerArgumentKind, operationSemantics } from "./operations.js";
import { planPackedSpanParameters } from "./packed-span.js";
import { factsForSource, SemanticFact, SemanticManifest } from "./manifest.js";
import { admitSource } from "./source-admission.js";
import {
  Binding,
  FunctionContext,
  FunctionSignature,
  OptimizationDiagnostic,
  OptimizationResult,
  OptimizationSummary,
  ParameterPromotion,
  ReturnPromotion,
} from "./model.js";
import {
  calleeName,
  isDeclarationIdentifier,
  isStrStaticCall,
  propertyCall,
  walk,
  WalkRef,
} from "./visitor.js";
import {
  expressionRepresentation,
  recordOriginalViewReceivers,
  rewriteDeclarationBoundaries,
  rewriteStatement,
} from "./rewrite.js";
import {
  expressionCanProduceView,
  expressionIsExplicitView,
} from "./expressions.js";

// Class-backed locals must either remove a native-to-view conversion or be
// reused enough to amortize their wrapper. Parameters have an extra call-site
// conversion, so they require multiple internal view boundaries instead of a
// raw identifier count. Packed spans and scalarized lengths have no wrapper
// cost and are handled separately below.
const MIN_PARAMETER_VIEW_BOUNDARIES = 2;
const MIN_LOCAL_VIEW_BOUNDARIES = 1;
const MIN_REUSED_LOCAL_USES = 3;

function summarize(diagnostics: OptimizationDiagnostic[]): OptimizationSummary {
  let promoted = 0;
  let rejected = 0;
  let conversions = 0;
  let estimatedAllocationsRemoved = 0;
  for (const diagnostic of diagnostics) {
    conversions += diagnostic.conversions;
    if (diagnostic.decision === "view") {
      promoted++;
      if (
        diagnostic.reason.includes("view-producing") ||
        diagnostic.reason.includes("profitable view") ||
        diagnostic.reason.includes("scalarized")
      ) {
        estimatedAllocationsRemoved++;
      }
    } else if (diagnostic.decision === "native") {
      rejected++;
    }
  }
  return {
    tracked: diagnostics.length,
    promoted,
    rejected,
    conversions,
    estimatedAllocationsRemoved,
  };
}

function decoratorName(decorator: DecoratorNode): string | null {
  const name = decorator.name;
  return name instanceof IdentifierExpression ? name.text : null;
}

function hasDecorator(
  decorators: DecoratorNode[] | null,
  expected: string,
): boolean {
  return !!decorators?.some(
    (decorator) => decoratorName(decorator) === expected,
  );
}

function hasLocalPragma(
  declaration: VariableDeclaration,
  pragma: "no-view" | "prefer-view",
): boolean {
  const text = declaration.range.source.text;
  const lineStart = text.lastIndexOf("\n", declaration.range.start - 1) + 1;
  if (lineStart <= 0) return false;
  const previousEnd = lineStart - 1;
  const previousStart = text.lastIndexOf("\n", previousEnd - 1) + 1;
  return (
    text.slice(previousStart, previousEnd).trim() === `// @as-str ${pragma}`
  );
}

function isUnsafeIntrinsic(call: CallExpression): boolean {
  const name = calleeName(call.expression);
  return (
    name === "changetype" ||
    name === "load" ||
    name === "store" ||
    name === "idof" ||
    name === "offsetof" ||
    name === "__pin" ||
    name === "__unpin" ||
    name === "__new"
  );
}

function functionIsClosed(
  declaration: FunctionDeclaration,
  owner: ClassDeclaration | null,
): boolean {
  if (
    declaration.is(CommonFlags.Export) &&
    !declaration.range.source.isLibrary
  ) {
    return false;
  }
  return (
    !owner &&
    !declaration.isAny(
      CommonFlags.Import |
        CommonFlags.Declare |
        CommonFlags.Ambient |
        CommonFlags.Public |
        CommonFlags.Override |
        CommonFlags.Closure,
    )
  );
}

function collectFunctionSignatures(
  source: Source,
  semanticFacts: Map<string, SemanticFact>,
): FunctionSignatures {
  const signatures = new FunctionSignatures();
  const ambiguous = new Set<string>();

  walk(source, (node, ref): boolean | void => {
    if (!(node instanceof FunctionDeclaration)) return;
    const name = node.name.text;
    if (signatures.has(name)) ambiguous.add(name);
    const annotatedResult = representationOfType(node.signature.returnType);
    signatures.set(name, {
      declaration: node,
      declarations: new Set([node]),
      parameters: node.signature.parameters.map((parameter) =>
        representationOfType(parameter.type),
      ),
      result:
        annotatedResult === "unknown"
          ? (semanticFacts.get(`return:${node.range.start}`)?.representation ??
            "unknown")
          : annotatedResult,
      callable: true,
      // A function value can have an explicit callback type or escape through
      // an indirect call. Its ABI is not established by its internal name.
      promotable:
        !(
          ref.parent instanceof FunctionExpression &&
          !(ref.grandparent instanceof ExpressionStatement)
        ) &&
        !node.signature.parameters.some(
          (parameter) => parameter.parameterKind === ParameterKind.Rest,
        ) &&
        functionIsClosed(
          node,
          ref.parent instanceof ClassDeclaration ? ref.parent : null,
        ),
      spanArgumentCounts: new Map(),
      directCallCount: 0,
      spanParameters: new Map(),
      lowercaseSpanParameters: new Set(),
      spanAppliedDeclarations: new Set(),
    });
  });

  for (const name of ambiguous) signatures.rejectAmbiguousName(name);

  // Preserve precision for direct, immutable local aliases such as
  // `const callback = helper; callback(value)`. The alias shares the original
  // signature and does not make the target an unresolved callback.
  walk(source, (node) => {
    if (
      !(node instanceof VariableDeclaration) ||
      !(node.initializer instanceof IdentifierExpression)
    ) {
      return;
    }
    const target = signatures.get(node.initializer.text);
    if (!target || signatures.has(node.name.text)) return;
    signatures.set(node.name.text, target);
  });

  // A function used as a value or callback does not have a closed set of calls.
  walk(source, (node, ref) => {
    if (!(node instanceof IdentifierExpression)) return;
    const signature = signatures.get(node.text);
    if (!signature || node === signature.declaration.name) return;
    if (isDeclarationIdentifier(node, ref)) return;
    if (
      ref.parent instanceof VariableDeclaration &&
      ref.parent.initializer === node &&
      signatures.get(ref.parent.name.text) === signature
    ) {
      return;
    }
    if (
      !(ref.parent instanceof CallExpression && ref.parent.expression === node)
    ) {
      signature.callable = false;
      signature.promotable = false;
    }
  });
  return signatures;
}

function viewReceiverRoot(expression: Expression): IdentifierExpression | null {
  if (expression instanceof IdentifierExpression) return expression;
  if (expression instanceof ParenthesizedExpression) {
    return viewReceiverRoot(expression.expression);
  }
  if (expression instanceof CallExpression) {
    const property = propertyCall(expression);
    if (
      !property ||
      operationSemantics(property.property.text).result !== "view"
    ) {
      return null;
    }
    return viewReceiverRoot(property.expression);
  }
  return null;
}

function countViewBoundaryUses(
  body: Statement,
  name: string,
  context: FunctionContext,
  signatures: FunctionSignatures,
): number {
  let count = 0;
  walk(body, (node, ref): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== context.declaration) {
      return false;
    }
    if (
      !(node instanceof IdentifierExpression) ||
      node.text !== name ||
      isDeclarationIdentifier(node, ref) ||
      !(ref.parent instanceof CallExpression)
    ) {
      return;
    }
    const index = ref.parent.args.indexOf(node);
    if (
      index >= 0 &&
      expectedCallArgument(ref.parent, index, signatures, context) === "view"
    ) {
      count++;
    }
  });
  return count;
}

function analyzeParameterPromotions(
  context: FunctionContext,
  signature: FunctionSignature | undefined,
  signatures: FunctionSignatures,
): ParameterPromotion[] {
  const declaration = context.declaration;
  if (!declaration) return [];
  const body = declaration.body;
  if (!body || !signature?.promotable || declaration.is(CommonFlags.Export)) {
    return [];
  }
  const promotions: ParameterPromotion[] = [];

  declaration.signature.parameters.forEach((parameter, index) => {
    if (signature.spanParameters.has(index)) return;
    if (representationOfType(parameter.type) !== "native") return;
    const name = parameter.name.text;
    if (context.bindings.has(name)) return;
    let usedInDefault = false;
    for (const other of declaration.signature.parameters) {
      walk(other.initializer, (node, ref) => {
        if (
          node instanceof IdentifierExpression &&
          node.text === name &&
          !isDeclarationIdentifier(node, ref)
        )
          usedInDefault = true;
      });
    }
    if (usedInDefault) return;

    let reason: string | null = null;
    let uses = 0;
    walk(body, (node, ref): boolean | void => {
      if (node instanceof FunctionDeclaration && node !== declaration) {
        walk(node.body, (nested) => {
          if (nested instanceof IdentifierExpression && nested.text === name) {
            reason ??= "captured by closure";
          }
        });
        return false;
      }
      if (
        !(node instanceof IdentifierExpression) ||
        node.text !== name ||
        isDeclarationIdentifier(node, ref)
      ) {
        return;
      }
      uses++;
      if (
        ref.parent instanceof CallExpression &&
        ref.parent.expression instanceof IdentifierExpression &&
        ref.parent.expression.text === declaration.name.text &&
        ref.parent.args.includes(node)
      ) {
        return;
      }
      reason ??= reasonForUse(node, ref, context, signatures);
    });

    walk(body, (node, ref): boolean | void => {
      if (node instanceof FunctionDeclaration && node !== declaration)
        return false;
      if (!(node instanceof CallExpression)) return;
      const property = propertyCall(node);
      if (
        !property ||
        operationSemantics(property.property.text).result !== "view"
      ) {
        return;
      }
      if (viewReceiverRoot(property.expression)?.text !== name) return;
      reason ??= derivedViewUseReason(node, ref, context, signatures);
    });

    const viewBoundaryUses = countViewBoundaryUses(
      body,
      name,
      context,
      signatures,
    );
    if (reason === null && viewBoundaryUses < MIN_PARAMETER_VIEW_BOUNDARIES) {
      reason = "class-backed parameter does not eliminate a net allocation";
    }
    const promoted = reason === null;
    if (promoted) {
      parameter.type = viewType(parameter.range);
      context.parameters.set(name, "view");
      signature.parameters[index] = "view";
    }
    promotions.push({
      index,
      name,
      promoted,
      reason:
        reason ?? "closed-world parameter with profitable view operations",
      uses,
    });
  });
  return promotions;
}

function returnCallUseReason(
  call: CallExpression,
  ref: WalkRef,
  declaration: FunctionDeclaration,
  signatures: FunctionSignatures,
): string | null {
  const parent = ref.parent;
  if (
    parent instanceof PropertyAccessExpression &&
    parent.expression === call &&
    operationSemantics(parent.property.text).result !== "unknown"
  ) {
    return null;
  }
  if (parent instanceof ElementAccessExpression && parent.expression === call) {
    return null;
  }
  if (parent instanceof CallExpression) {
    const index = parent.args.indexOf(call);
    if (
      index >= 0 &&
      expectedCallArgument(parent, index, signatures) === "view"
    ) {
      return null;
    }
  }
  if (
    parent instanceof ReturnStatement &&
    call.expression instanceof IdentifierExpression &&
    call.expression.text === declaration.name.text
  ) {
    return null;
  }
  return "return value reaches a native or unknown boundary";
}

function analyzeReturnPromotion(
  context: FunctionContext,
  signature: FunctionSignature | undefined,
  source: Source,
  signatures: FunctionSignatures,
): ReturnPromotion | null {
  const declaration = context.declaration;
  const body = declaration.body;
  if (
    !body ||
    !signature?.promotable ||
    signature.result === "view" ||
    declaration.is(CommonFlags.Export)
  )
    return null;

  let profitable = false;
  let hasValueReturn = false;
  walk(body, (node): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (node instanceof ReturnStatement && node.value) {
      hasValueReturn = true;
      if (expressionCanProduceView(node.value)) profitable = true;
    }
  });
  if (!hasValueReturn || !profitable) return null;

  let reason: string | null = null;
  let uses = 0;
  walk(source, (node, ref) => {
    if (
      !(node instanceof CallExpression) ||
      !(node.expression instanceof IdentifierExpression) ||
      node.expression.text !== declaration.name.text
    ) {
      return;
    }
    uses++;
    reason ??= returnCallUseReason(node, ref, declaration, signatures);
  });
  if (uses === 0) reason = "no statically known call sites";

  if (reason === null) {
    reason = "class-backed return only substitutes a wrapper allocation";
  }
  const promoted = reason === null;
  if (promoted) {
    declaration.signature.returnType = viewType(
      declaration.signature.returnType.range,
    );
    signature.result = "view";
  }
  return {
    promoted,
    reason: reason ?? "closed-world return with profitable view result",
    uses,
  };
}

function initializerElementRepresentation(
  expression: Expression | null,
): Representation {
  if (!(expression instanceof NewExpression)) return "unknown";
  const name = expression.typeName.identifier.text;
  if (name !== "Array" && name !== "StaticArray") return "unknown";
  return representationOfType(expression.typeArguments?.[0] ?? null);
}

function collectLocalBindings(
  declaration: FunctionDeclaration,
  semanticFacts: Map<string, SemanticFact>,
  classes: SourceClassTypes,
  globals: Map<VariableDeclaration, Representation>,
): FunctionContext {
  const bindings = new Map<string, Binding>();
  const parameters = new Map<string, Representation>();
  const duplicateNames = new Set<string>();
  const body = declaration.body;
  const lowercaseReceiverCounts = new Map<string, number>();
  const localUseCounts = new Map<string, number>();
  const profitableLowercaseCalls = new Set<number>();
  let representationSensitive = false;

  for (const parameter of declaration.signature.parameters) {
    parameters.set(parameter.name.text, representationOfType(parameter.type));
  }

  if (body) {
    walk(body, (node): boolean | void => {
      if (node instanceof FunctionDeclaration && node !== declaration)
        return false;
      if (node instanceof CallExpression && isUnsafeIntrinsic(node))
        representationSensitive = true;
      if (!(node instanceof VariableDeclaration)) return;

      const name = node.name.text;
      if (bindings.has(name) || parameters.has(name)) duplicateNames.add(name);
      const declared = representationOfType(node.type);
      const fact = semanticFacts.get(`local:${node.range.start}`);
      const nullable = typeIsNullable(node.type) || fact?.nullable === true;
      const semantic = nullable
        ? "unknown"
        : (fact?.representation ?? declared);
      const noView =
        hasDecorator(node.decorators, "noView") ||
        hasLocalPragma(node, "no-view");
      const preferView =
        hasDecorator(node.decorators, "preferView") ||
        hasLocalPragma(node, "prefer-view");
      const explicitView =
        !nullable &&
        declared !== "native" &&
        expressionIsExplicitView(node.initializer);
      const candidate =
        !nullable &&
        !noView &&
        !explicitView &&
        (declared === "unknown" || declared === "native") &&
        !!node.initializer &&
        (expressionCanProduceView(node.initializer) || preferView);
      bindings.set(name, {
        declaration: node,
        name,
        declared,
        semantic: explicitView ? "view" : semantic,
        decision: nullable
          ? "unknown"
          : noView
            ? declared !== "unknown"
              ? declared
              : explicitView
                ? "view"
                : semantic
            : explicitView
              ? "view"
              : declared,
        candidate,
        preferred: preferView,
        forcedReason: noView
          ? "@as-str no-view"
          : preferView && !node.initializer
            ? "@as-str prefer-view requires an initializer"
            : null,
        uses: 0,
        conversions: 0,
        element:
          elementRepresentationOfType(node.type) === "unknown"
            ? initializerElementRepresentation(node.initializer)
            : elementRepresentationOfType(node.type),
        scalarizedLength: false,
        scalarizedSpan: false,
        packedSpan: null,
      });
    });
    walk(body, (node): boolean | void => {
      if (node instanceof FunctionDeclaration && node !== declaration) {
        return false;
      }
      if (!(node instanceof CallExpression)) return;
      const property = propertyCall(node);
      if (
        property?.property.text !== "toLowerCase" ||
        !(property.expression instanceof IdentifierExpression)
      ) {
        return;
      }
      const name = property.expression.text;
      lowercaseReceiverCounts.set(
        name,
        (lowercaseReceiverCounts.get(name) ?? 0) + 1,
      );
    });
    walk(body, (node, ref): boolean | void => {
      if (node instanceof FunctionDeclaration && node !== declaration) {
        return false;
      }
      if (
        !(node instanceof IdentifierExpression) ||
        isDeclarationIdentifier(node, ref)
      ) {
        return;
      }
      localUseCounts.set(node.text, (localUseCounts.get(node.text) ?? 0) + 1);
    });
    walk(body, (node, ref): boolean | void => {
      if (node instanceof FunctionDeclaration && node !== declaration) {
        return false;
      }
      if (
        !(node instanceof CallExpression) ||
        !(ref.parent instanceof VariableDeclaration) ||
        ref.parent.initializer !== node ||
        (localUseCounts.get(ref.parent.name.text) ?? 0) < 2
      ) {
        return;
      }
      const property = propertyCall(node);
      if (property?.property.text !== "toLowerCase") return;
      const receiverCall =
        property.expression instanceof CallExpression
          ? propertyCall(property.expression)
          : null;
      if (
        receiverCall &&
        operationSemantics(receiverCall.property.text).result === "view"
      ) {
        return;
      }
      profitableLowercaseCalls.add(node.range.start);
    });
  }

  for (const name of duplicateNames) {
    const binding = bindings.get(name);
    if (binding) binding.forcedReason = "shadowed or duplicate local name";
  }

  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const binding of bindings.values()) {
      if (
        binding.candidate ||
        binding.declared !== "unknown" ||
        !(binding.declaration.initializer instanceof IdentifierExpression)
      ) {
        continue;
      }
      const source = bindings.get(binding.declaration.initializer.text);
      if (source?.candidate) {
        binding.candidate = true;
        propagated = true;
      }
    }
  }

  return {
    declaration,
    bindings,
    parameters,
    globals,
    parameterSpans: new Map(),
    lowercaseSpans: new Set(),
    repeatedLowercaseReceivers: new Set(
      [...lowercaseReceiverCounts]
        .filter(([, count]) => count > 1)
        .map(([name]) => name),
    ),
    profitableLowercaseCalls,
    representationSensitive,
    classes,
    duplicateNames,
  };
}

function collectGlobalRepresentations(
  source: Source,
  facts: Map<string, SemanticFact>,
): Map<VariableDeclaration, Representation> {
  const globals = new Map<VariableDeclaration, Representation>();
  walk(source, (node, ref) => {
    if (
      !(node instanceof VariableDeclaration) ||
      (ref.grandparent !== source &&
        !(ref.grandparent instanceof NamespaceDeclaration))
    )
      return;
    const fact = facts.get(`global:${node.range.start}`);
    const declared = representationOfType(node.type);
    globals.set(
      node,
      typeIsNullable(node.type) || fact?.nullable
        ? "unknown"
        : (fact?.representation ??
            (declared !== "unknown"
              ? declared
              : node.initializer instanceof StringLiteralExpression
                ? "native"
                : "unknown")),
    );
  });
  return globals;
}

function expectedCallArgument(
  call: CallExpression,
  index: number,
  signatures: FunctionSignatures,
  context?: FunctionContext,
): Representation {
  if (isStrStaticCall(call)) return "view";
  const declared = context
    ? declaredCallSignature(call, context, signatures)
    : undefined;
  if (declared) return declared.parameters[index] ?? "unknown";
  const callback = context ? declaredCallType(call, context) : undefined;
  if (callback) return representationOfType(callArgumentType(callback, index));
  const property =
    call.expression instanceof PropertyAccessExpression
      ? call.expression
      : null;
  const containerArgument = property
    ? containerArgumentKind(property.property.text, index)
    : null;
  if (containerArgument) {
    if (containerArgument === "other") return "unknown";
    const type = context?.classes.typeOf(property!.expression, context);
    return type
      ? elementRepresentationOfType(type)
      : property!.expression instanceof IdentifierExpression
        ? (context?.bindings.get(property!.expression.text)?.element ??
          "unknown")
        : "unknown";
  }

  const name =
    calleeName(call.expression) ??
    (property && operationSemantics(property.property.text).result === "unknown"
      ? property.property.text
      : null);
  if (!name) return "unknown";
  const signature = context
    ? signatureForCall(call, context, signatures)
    : signatures.get(name);
  if (!signature || !signature.callable) return "unknown";
  return signature.parameters[index] ?? "unknown";
}

function reasonForUse(
  node: IdentifierExpression,
  ref: WalkRef,
  context: FunctionContext,
  signatures: FunctionSignatures,
): string | null {
  let parent = ref.parent;
  let grandparent = ref.grandparent;

  while (parent instanceof ParenthesizedExpression) {
    grandparent = null;
    parent = parent.range === node.range ? parent : parent;
    break;
  }

  if (parent instanceof PropertyAccessExpression && ref.key === "expression") {
    if (operationSemantics(parent.property.text).container) {
      return `view container result from .${parent.property.text} is not yet modeled`;
    }
    return operationSemantics(parent.property.text).result !== "unknown"
      ? null
      : `unknown member .${parent.property.text}`;
  }

  if (parent instanceof ElementAccessExpression && ref.key === "expression") {
    return null;
  }

  if (parent instanceof AssertionExpression)
    return "explicit cast or assertion";

  if (parent instanceof VariableDeclaration && parent.initializer === node) {
    const target = context.bindings.get(parent.name.text);
    if (target?.candidate || target?.declared === "view") return null;
    return target?.declared === "native"
      ? "initializer for native string"
      : "initializer for unknown target";
  }

  if (parent instanceof CallExpression) {
    if (parent.expression === node) return "called as a function";
    const index = parent.args.indexOf(node);
    if (index >= 0) {
      if (isUnsafeIntrinsic(parent))
        return "raw-memory or representation intrinsic";
      const expected = expectedCallArgument(parent, index, signatures, context);
      if (expected === "view") return null;
      return expected === "native"
        ? "native string function parameter"
        : "unknown or external call";
    }
  }

  if (parent instanceof ReturnStatement) {
    if (!context.declaration) return "return outside analyzed function";
    const result = representationOfType(
      context.declaration.signature.returnType,
    );
    if (result === "view") return null;
    return result === "native"
      ? "native string return boundary"
      : "inferred or unknown return boundary";
  }

  if (parent instanceof BinaryExpression) {
    if (parent.operator === Token.Equals) {
      if (parent.left === node) return null;
      if (
        parent.right === node &&
        parent.left instanceof IdentifierExpression
      ) {
        const target = context.classes.bindingOf(parent.left, context);
        if (target?.candidate || target?.declared === "view") return null;
        return target?.declared === "native"
          ? "assignment to native string"
          : "assignment to unknown target";
      }
    }
    if (
      parent.operator === Token.Equals_Equals ||
      parent.operator === Token.Equals_Equals_Equals ||
      parent.operator === Token.Exclamation_Equals ||
      parent.operator === Token.Exclamation_Equals_Equals
    ) {
      return null;
    }
    return "operator use";
  }

  if (parent instanceof TernaryExpression) return "conditional merge";
  if (parent instanceof CommaExpression) return "comma expression";
  if (parent instanceof ThrowStatement) return "throw boundary";

  if (grandparent instanceof CallExpression) {
    const property = parent;
    if (
      property instanceof PropertyAccessExpression &&
      grandparent.expression === property &&
      operationSemantics(property.property.text).result !== "unknown"
    ) {
      return null;
    }
  }

  return "unsupported or escaping use";
}

function derivedViewUseReason(
  call: CallExpression,
  ref: WalkRef,
  context: FunctionContext,
  signatures: FunctionSignatures,
): string | null {
  const parent = ref.parent;

  if (
    parent instanceof PropertyAccessExpression &&
    parent.expression === call &&
    operationSemantics(parent.property.text).result !== "unknown"
  ) {
    return null;
  }
  if (parent instanceof ElementAccessExpression && parent.expression === call) {
    return null;
  }
  if (parent instanceof VariableDeclaration && parent.initializer === call) {
    const target = context.bindings.get(parent.name.text);
    if (target?.candidate || target?.declared === "view") return null;
    return target?.declared === "native" || target?.semantic === "native"
      ? "derived view assigned to native string"
      : "derived view assigned to unknown target";
  }
  if (parent instanceof CallExpression) {
    if (
      parent.expression instanceof IdentifierExpression &&
      parent.expression.text === context.declaration?.name.text &&
      parent.args.includes(call)
    ) {
      return null;
    }
    const index = parent.args.indexOf(call);
    if (index >= 0) {
      const expected = expectedCallArgument(parent, index, signatures, context);
      if (expected === "view") return null;
      return expected === "native"
        ? "derived view passed to native string parameter"
        : "derived view passed to unknown or external call";
    }
  }
  if (parent instanceof ReturnStatement) {
    const result = representationOfType(
      context.declaration?.signature.returnType ?? null,
    );
    if (result === "view") return null;
    return result === "native"
      ? "derived view reaches native string return"
      : "derived view reaches inferred or unknown return";
  }
  if (parent instanceof BinaryExpression) {
    if (
      parent.operator === Token.Equals &&
      parent.right === call &&
      parent.left instanceof IdentifierExpression
    ) {
      const target = context.classes.bindingOf(parent.left, context);
      if (target?.candidate || target?.declared === "view") return null;
      return target?.declared === "native" || target?.semantic === "native"
        ? "derived view assigned to native string"
        : "derived view assigned to unknown target";
    }
    return "derived view used by operator";
  }
  if (parent instanceof TernaryExpression)
    return "derived view used by conditional merge";
  if (parent instanceof CommaExpression) return "derived view used by comma";
  if (parent instanceof ThrowStatement) return "derived view reaches throw";

  return "derived view reaches unsupported or escaping use";
}

function candidateReceiver(
  expression: Expression,
  context: FunctionContext,
): Binding | null {
  const root = viewReceiverRoot(expression);
  if (!root) return null;
  const binding = context.classes.bindingOf(root, context);
  return binding?.candidate ? binding : null;
}

function analyzeCandidates(
  context: FunctionContext,
  signatures: FunctionSignatures,
): void {
  const declaration = context.declaration;
  if (!declaration) return;
  const body = declaration.body;
  if (!body) return;

  // Resolve uses once. Classification below scans only each binding's uses,
  // rather than walking the function once for every candidate.
  const bindingUses = new Map<
    Binding,
    { node: IdentifierExpression; ref: WalkRef }[]
  >();
  walk(body, (node, ref): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (
      !(node instanceof IdentifierExpression) ||
      isDeclarationIdentifier(node, ref)
    )
      return;
    const binding = context.classes.bindingOf(node, context);
    if (
      !binding ||
      context.classes.declarationOf(node, context) !== binding.declaration
    )
      return;
    const uses = bindingUses.get(binding) ?? [];
    uses.push({ node, ref });
    bindingUses.set(binding, uses);
  });

  // The pragma prevents promotion; it must not change an inferred view into
  // a native string. Infer only after parameters and scoped call types exist.
  for (const binding of context.bindings.values()) {
    if (
      binding.forcedReason === "@as-str no-view" &&
      binding.decision === "unknown" &&
      !typeIsNullable(binding.declaration.type) &&
      binding.declaration.initializer
    )
      binding.decision = expressionRepresentation(
        binding.declaration.initializer,
        context,
        signatures,
      );
  }

  // A familiar method name on a non-string object is not a string operation.
  for (const binding of context.bindings.values()) {
    // Raw pointers can observe allocation identity through methods and aliases,
    // even when the candidate identifier is not an intrinsic's direct argument.
    if (context.representationSensitive && binding.candidate)
      binding.forcedReason ??= "raw-memory or representation intrinsic";
    const init = binding.declaration.initializer;
    if (!binding.candidate || !(init instanceof CallExpression)) continue;
    const property = propertyCall(init);
    if (!property || isStrStaticCall(init)) continue;
    if (
      expressionRepresentation(property.expression, context, signatures) ===
      "unknown"
    ) {
      binding.candidate = false;
      binding.decision = binding.semantic;
    }
  }

  walk(body, (node, ref): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== declaration) {
      walk(node.body, (nested): void => {
        if (!(nested instanceof IdentifierExpression)) return;
        const binding = context.bindings.get(nested.text);
        if (binding?.candidate) binding.forcedReason = "captured by closure";
      });
      return false;
    }
    if (
      !(node instanceof IdentifierExpression) ||
      isDeclarationIdentifier(node, ref)
    ) {
      return;
    }
    const binding = context.classes.bindingOf(node, context);
    if (!binding?.candidate || node === binding.declaration.name) return;
    binding.uses++;
    const reason = reasonForUse(node, ref, context, signatures);
    if (reason && !binding.forcedReason) binding.forcedReason = reason;
  });

  // A candidate can be safe as a receiver while the view produced by one of
  // its methods is not. Keep the receiver native when that derived value
  // crosses a boundary the rewriter cannot prove to accept a view.
  walk(body, (node, ref): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (!(node instanceof CallExpression)) return;
    const property = propertyCall(node);
    if (
      !property ||
      operationSemantics(property.property.text).result !== "view"
    ) {
      return;
    }
    const binding = candidateReceiver(property.expression, context);
    if (!binding || binding.forcedReason) return;
    const reason = derivedViewUseReason(node, ref, context, signatures);
    if (reason) binding.forcedReason = reason;
  });

  for (const binding of context.bindings.values()) {
    if (!binding.candidate) continue;
    binding.decision = binding.forcedReason ? "native" : "view";
    if (
      binding.decision !== "view" ||
      binding.uses === 0 ||
      !(binding.declaration.initializer instanceof CallExpression)
    ) {
      continue;
    }
    const initializer = propertyCall(binding.declaration.initializer);
    if (
      !initializer ||
      !operationSemantics(initializer.property.text).lengthFusible
    ) {
      continue;
    }
    const receiver = isStrStaticCall(binding.declaration.initializer)
      ? binding.declaration.initializer.args[0]
      : initializer.expression;
    if (
      !receiver ||
      expressionRepresentation(receiver, context, signatures) === "unknown"
    )
      continue;
    const onlyLengthReads = (bindingUses.get(binding) ?? []).every(
      ({ ref }) =>
        ref.parent instanceof PropertyAccessExpression &&
        ref.key === "expression" &&
        ref.parent.property.text === "length",
    );
    binding.scalarizedLength = onlyLengthReads;
  }

  const consumers = new Map<CallExpression, Binding>();
  for (const target of context.bindings.values()) {
    if (target.declaration.initializer instanceof CallExpression) {
      consumers.set(target.declaration.initializer, target);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const binding of context.bindings.values()) {
      if (
        binding.decision !== "view" ||
        binding.scalarizedLength ||
        binding.scalarizedSpan ||
        !(binding.declaration.initializer instanceof CallExpression)
      ) {
        continue;
      }
      const initializer = propertyCall(binding.declaration.initializer);
      if (
        !initializer ||
        !operationSemantics(initializer.property.text).spanProducing
      )
        continue;
      const receiver = isStrStaticCall(binding.declaration.initializer)
        ? binding.declaration.initializer.args[0]
        : initializer.expression;
      if (
        !receiver ||
        expressionRepresentation(receiver, context, signatures) === "unknown"
      )
        continue;
      const receiverBinding =
        receiver instanceof IdentifierExpression
          ? context.classes.bindingOf(receiver, context)
          : null;
      const owner =
        receiverBinding?.scalarizedSpan && receiverBinding.packedSpan
          ? receiverBinding.packedSpan.owner
          : receiver instanceof IdentifierExpression
            ? { kind: "identifier" as const, name: receiver.text }
            : receiver instanceof StringLiteralExpression
              ? { kind: "string-literal" as const, value: receiver.value }
              : null;
      if (owner === null) continue;

      let scalarUsesOnly = true;
      for (const { ref } of bindingUses.get(binding) ?? []) {
        if (
          ref.parent instanceof PropertyAccessExpression &&
          ref.key === "expression"
        ) {
          if (
            ref.parent.property.text === "length" ||
            ref.parent.property.text === "isEmpty"
          ) {
            continue;
          }
          if (
            ref.grandparent instanceof CallExpression &&
            ref.grandparent.expression === ref.parent &&
            operationSemantics(ref.parent.property.text).spanScalar
          ) {
            continue;
          }
          if (
            ref.grandparent instanceof CallExpression &&
            ref.grandparent.expression === ref.parent &&
            operationSemantics(ref.parent.property.text).spanProducing
          ) {
            const target = consumers.get(ref.grandparent);
            if (target?.scalarizedLength || target?.scalarizedSpan) continue;
          }
        }
        if (
          ref.parent instanceof BinaryExpression &&
          (ref.parent.operator === Token.Equals_Equals ||
            ref.parent.operator === Token.Equals_Equals_Equals ||
            ref.parent.operator === Token.Exclamation_Equals ||
            ref.parent.operator === Token.Exclamation_Equals_Equals)
        ) {
          continue;
        }
        scalarUsesOnly = false;
      }
      if (!scalarUsesOnly) continue;
      binding.scalarizedSpan = true;
      binding.packedSpan = { owner };
      changed = true;
    }
  }

  changed = true;
  while (changed) {
    changed = false;
    for (const binding of context.bindings.values()) {
      if (
        !binding.scalarizedSpan ||
        !(binding.declaration.initializer instanceof CallExpression)
      ) {
        continue;
      }
      const parts = propertyCall(binding.declaration.initializer);
      if (!parts) continue;
      const receiver = isStrStaticCall(binding.declaration.initializer)
        ? binding.declaration.initializer.args[0]
        : parts.expression;
      if (!(receiver instanceof IdentifierExpression)) continue;
      const receiverBinding = context.classes.bindingOf(receiver, context);
      if (
        receiverBinding?.scalarizedSpan &&
        receiverBinding.packedSpan &&
        binding.packedSpan !== receiverBinding.packedSpan
      ) {
        binding.packedSpan = receiverBinding.packedSpan;
        changed = true;
      }
    }
  }

  for (const binding of context.bindings.values()) {
    if (
      binding.candidate &&
      binding.decision === "view" &&
      !binding.preferred &&
      !binding.scalarizedLength &&
      !binding.scalarizedSpan &&
      (bindingUses.get(binding) ?? []).filter(
        ({ node, ref }) =>
          ref.parent instanceof CallExpression &&
          ref.parent.args.includes(node) &&
          expectedCallArgument(
            ref.parent,
            ref.parent.args.indexOf(node),
            signatures,
            context,
          ) === "view",
      ).length < MIN_LOCAL_VIEW_BOUNDARIES &&
      binding.uses < MIN_REUSED_LOCAL_USES
    ) {
      binding.decision = "native";
      binding.forcedReason =
        "class-backed local does not eliminate a net allocation";
    }
  }
}

function diagnosticFor(binding: Binding): OptimizationDiagnostic {
  const source = binding.declaration.range.source;
  const line = source.lineAt(binding.declaration.range.start);
  const column = source.columnAt();
  return {
    source: source.normalizedPath,
    line,
    column,
    binding: binding.name,
    decision: binding.decision,
    reason:
      binding.decision === "view"
        ? binding.scalarizedSpan
          ? "scalarized non-escaping view into a packed pointer span"
          : binding.scalarizedLength
            ? "scalarized length-only view without allocating a Str object"
            : binding.preferred
              ? "promoted by @as-str prefer-view after safety checks"
              : "view-producing local with only view-safe uses"
        : (binding.forcedReason ?? "not a profitable view candidate"),
    uses: binding.uses,
    conversions: binding.conversions,
  };
}

function collectFunctions(source: Source): FunctionDeclaration[] {
  const functions: FunctionDeclaration[] = [];
  walk(source, (node) => {
    if (node instanceof FunctionDeclaration && node.body) functions.push(node);
  });
  return functions;
}

function sourceUsesViewName(source: Source): boolean {
  let usesView = false;
  walk(source, (node): boolean | void => {
    if (node instanceof IdentifierExpression && node.text === "str") {
      usesView = true;
      return false;
    }
  });
  return usesView;
}

function representationEffects(
  node: Node,
  context: FunctionContext,
): {
  targets: Node[];
  opaque: boolean;
} {
  if (node instanceof PropertyAccessExpression) {
    const targets = context.classes.accessorsOf(node, context);
    return {
      targets,
      opaque: targets.some(
        (target) =>
          !target.body && admitSource(target.range.source).semanticFacts,
      ),
    };
  }
  if (node instanceof NewExpression) {
    const declaration = classDeclarationOfType(
      context.classes.typeOf(node, context),
    );
    return { targets: declaration ? [declaration] : [], opaque: false };
  }
  if (!(node instanceof CallExpression)) return { targets: [], opaque: false };
  const target = context.classes.callableOf(node.expression, context);
  return {
    targets: target ? [target] : [],
    opaque:
      isUnsafeIntrinsic(node) ||
      (target
        ? !target.body && admitSource(target.range.source).semanticFacts
        : (node.expression instanceof IdentifierExpression &&
            (context.parameters.has(node.expression.text) ||
              !!context.classes.declarationOf(node.expression, context))) ||
          context.classes.typeOf(node.expression, context) instanceof
            FunctionTypeNode),
  };
}

/** Propagate raw-memory observations through calls, accessors and construction. */
function representationSensitiveDeclarations(sources: Source[]): Set<Node> {
  const contexts = new Map<
    FunctionDeclaration | ClassDeclaration,
    FunctionContext
  >();
  for (const source of sources) {
    const classes = new SourceClassTypes(source);
    walk(source, (node) => {
      if (
        !(
          node instanceof ClassDeclaration ||
          (node instanceof FunctionDeclaration && node.body)
        )
      )
        return;
      contexts.set(node, {
        declaration: node instanceof FunctionDeclaration ? node : null,
        className: classes.ownerOf(node),
        classes,
        bindings: new Map(),
        globals: new Map(),
        parameters: new Map(
          node instanceof FunctionDeclaration
            ? node.signature.parameters.map((parameter) => [
                parameter.name.text,
                representationOfType(parameter.type),
              ])
            : [],
        ),
        parameterSpans: new Map(),
        lowercaseSpans: new Set(),
        repeatedLowercaseReceivers: new Set(),
        profitableLowercaseCalls: new Set(),
        duplicateNames: new Set(),
      });
    });
  }
  const sensitive = new Set<Node>();
  const callers = new Map<Node, Set<Node>>();
  const link = (caller: Node, callee: Node): void => {
    const incoming = callers.get(callee) ?? new Set();
    incoming.add(caller);
    callers.set(callee, incoming);
  };
  for (const [declaration, context] of contexts) {
    const roots: Node[] = [];
    if (declaration instanceof FunctionDeclaration) {
      roots.push(declaration.body!);
      for (const parameter of declaration.signature.parameters)
        if (parameter.initializer) roots.push(parameter.initializer);
    } else {
      const parent = classDeclarationOfType(declaration.extendsType);
      if (parent) link(declaration, parent);
      for (const member of declaration.members) {
        if (member instanceof FieldDeclaration && member.initializer)
          roots.push(member.initializer);
        if (
          member instanceof FunctionDeclaration &&
          member.name.text === "constructor"
        ) {
          if (member.body) link(declaration, member);
          else sensitive.add(declaration);
        }
      }
    }
    for (const root of roots)
      walk(root, (node): boolean | void => {
        if (node instanceof FunctionDeclaration) return false;
        if (
          !(
            node instanceof CallExpression ||
            node instanceof PropertyAccessExpression ||
            node instanceof NewExpression
          )
        )
          return;
        const effects = representationEffects(node, context);
        if (effects.opaque) sensitive.add(declaration);
        for (const callee of effects.targets) link(declaration, callee);
      });
  }
  // A call through a base type may dispatch to any known overriding method.
  // Link the base declaration to overrides before propagating effects, including
  // virtual calls made by base constructors and accessors.
  for (const declaration of contexts.keys()) {
    if (!(declaration instanceof ClassDeclaration)) continue;
    const seen = new Set<ClassDeclaration>();
    let parent = classDeclarationOfType(declaration.extendsType);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      for (const method of declaration.members) {
        if (
          !(method instanceof FunctionDeclaration) ||
          method.is(CommonFlags.Static) ||
          method.name.text === "constructor"
        )
          continue;
        for (const base of parent.members) {
          if (
            !(base instanceof FunctionDeclaration) ||
            base.is(CommonFlags.Static) ||
            base.name.text !== method.name.text
          )
            continue;
          if (
            base.is(CommonFlags.Get) === method.is(CommonFlags.Get) &&
            base.is(CommonFlags.Set) === method.is(CommonFlags.Set)
          )
            link(base, method);
        }
      }
      parent = classDeclarationOfType(parent.extendsType);
    }
  }
  const pending = [...sensitive];
  for (let i = 0; i < pending.length; i++) {
    for (const caller of callers.get(pending[i]) ?? []) {
      if (sensitive.has(caller)) continue;
      sensitive.add(caller);
      pending.push(caller);
    }
  }
  return sensitive;
}

function hasSensitiveCalls(
  node: Node,
  context: FunctionContext,
  sensitive: ReadonlySet<Node>,
): boolean {
  let found = false;
  walk(node, (child): boolean | void => {
    if (child instanceof FunctionDeclaration) return false;
    if (
      !(
        child instanceof CallExpression ||
        child instanceof PropertyAccessExpression ||
        child instanceof NewExpression
      )
    )
      return;
    const effects = representationEffects(child, context);
    if (
      effects.opaque ||
      effects.targets.some((callee) => sensitive.has(callee))
    )
      found = true;
  });
  return found;
}

export function optimizeSource(
  source: Source,
  manifest: SemanticManifest | null = null,
  sharedSignatures: FunctionSignatures | null = null,
  sensitiveDeclarations: ReadonlySet<Node> = representationSensitiveDeclarations(
    [source],
  ),
): OptimizationResult {
  const changedSources = new Set<Source>();
  const diagnostics: OptimizationDiagnostic[] = [];
  const semanticFacts = factsForSource(manifest, source);
  for (const fact of semanticFacts.values()) {
    if (fact.kind === "local") continue;
    const line = source.lineAt(fact.start);
    const column = source.columnAt();
    diagnostics.push({
      source: source.normalizedPath,
      line,
      column,
      binding: `${fact.name} ${fact.kind}`,
      decision: fact.representation,
      reason: `tracked resolved ${fact.resolvedType}`,
      uses: 0,
      conversions: 0,
    });
  }
  const localSignatures = collectFunctionSignatures(source, semanticFacts);
  const signatures = sharedSignatures
    ? new FunctionSignatures(sharedSignatures)
    : localSignatures;
  if (sharedSignatures) {
    for (const [name, local] of localSignatures) {
      const shared = sharedSignatures.forDeclaration(local.declaration);
      signatures.set(name, shared ?? local);
    }
  }
  const classes = new SourceClassTypes(source);
  const globals = collectGlobalRepresentations(source, semanticFacts);
  const canPromoteBoundaries = manifest?.complete === true;

  const functions = collectFunctions(source);
  const contexts = new Map<FunctionDeclaration, FunctionContext>();
  for (const declaration of functions) {
    const context = collectLocalBindings(
      declaration,
      semanticFacts,
      classes,
      globals,
    );
    context.representationSensitive ||= sensitiveDeclarations.has(declaration);
    contexts.set(declaration, context);
    if (context.representationSensitive) {
      const signature = signatureForDeclaration(declaration, signatures);
      if (signature) signature.promotable = false;
    }
  }

  const sourceContext: FunctionContext = {
    declaration: null,
    globals: collectGlobalRepresentations(source, semanticFacts),
    bindings: new Map(),
    parameters: new Map(),
    parameterSpans: new Map(),
    lowercaseSpans: new Set(),
    repeatedLowercaseReceivers: new Set(),
    profitableLowercaseCalls: new Set(),
    classes,
    duplicateNames: new Set(),
  };
  sourceContext.representationSensitive =
    functions.some((declaration) => sensitiveDeclarations.has(declaration)) ||
    hasSensitiveCalls(source, sourceContext, sensitiveDeclarations);
  rewriteDeclarationBoundaries(source.statements, sourceContext, signatures);
  if (sourceContext.temporaryOwners?.length) {
    source.statements.unshift(...sourceContext.temporaryOwners);
  }

  // Record explicit view receivers before promotion changes native bindings.
  for (const context of contexts.values()) {
    recordOriginalViewReceivers(
      context.declaration!.body!,
      context,
      signatures,
    );
  }

  // Parameter decisions precede local rewrites so call sites see final types.
  for (const declaration of functions) {
    const context = contexts.get(declaration)!;
    const signature = signatureForDeclaration(declaration, signatures);
    const packedSpanPlan = canPromoteBoundaries
      ? planPackedSpanParameters(context, signature)
      : null;
    const promotions = canPromoteBoundaries
      ? analyzeParameterPromotions(context, signature, signatures)
      : [];
    if (packedSpanPlan?.apply()) changedSources.add(source);
    for (const promotion of promotions) {
      const parameter = declaration.signature.parameters[promotion.index];
      const location = parameter.range.source;
      const line = location.lineAt(parameter.range.start);
      const column = location.columnAt();
      diagnostics.push({
        source: source.normalizedPath,
        line,
        column,
        binding: promotion.name,
        decision: promotion.promoted ? "view" : "native",
        reason: promotion.reason,
        uses: promotion.uses,
        conversions: 0,
      });
      if (promotion.promoted) changedSources.add(source);
    }
  }

  for (const declaration of functions) {
    const context = contexts.get(declaration)!;
    const signature = signatureForDeclaration(declaration, signatures);
    const promotion = canPromoteBoundaries
      ? analyzeReturnPromotion(context, signature, source, signatures)
      : null;
    if (!promotion) continue;
    const range = declaration.signature.returnType.range;
    const location = range.source;
    const line = location.lineAt(range.start);
    const column = location.columnAt();
    diagnostics.push({
      source: source.normalizedPath,
      line,
      column,
      binding: `${declaration.name.text} return`,
      decision: promotion.promoted ? "view" : "native",
      reason: promotion.reason,
      uses: promotion.uses,
      conversions: 0,
    });
    if (promotion.promoted) changedSources.add(source);
  }

  for (const declaration of functions) {
    if (!declaration.body) continue;
    const context = contexts.get(declaration)!;
    analyzeCandidates(context, signatures);

    rewriteStatement(declaration.body, context, signatures);
    if (
      context.temporaryOwners?.length &&
      declaration.body instanceof BlockStatement
    ) {
      declaration.body.statements.unshift(...context.temporaryOwners);
    }
    for (const binding of context.bindings.values()) {
      if (binding.candidate) {
        diagnostics.push(diagnosticFor(binding));
      } else if (binding.semantic !== "unknown" || binding.forcedReason) {
        const tracked = diagnosticFor(binding);
        tracked.decision =
          binding.semantic === "unknown" ? binding.decision : binding.semantic;
        tracked.reason =
          binding.forcedReason ??
          "tracked string; no profitable view operation";
        diagnostics.push(tracked);
      }
    }
  }

  if (sourceUsesViewName(source)) changedSources.add(source);
  return { changedSources, diagnostics, summary: summarize(diagnostics) };
}

export function optimizeSources(
  sources: Source[],
  manifest: SemanticManifest | null = null,
): OptimizationResult {
  const changedSources = new Set<Source>();
  const diagnostics: OptimizationDiagnostic[] = [];
  const userSources = sources.filter(
    (source) => admitSource(source).optimization,
  );
  const sharedSignatures = new FunctionSignatures();
  const ambiguous = new Set<string>();
  for (const source of userSources) {
    const sourceSignatures = collectFunctionSignatures(
      source,
      factsForSource(manifest, source),
    );
    sharedSignatures.includeDeclarations(sourceSignatures);
    for (const [name, signature] of sourceSignatures) {
      const existing = sharedSignatures.get(name);
      if (!existing) {
        sharedSignatures.set(name, signature);
      } else if (
        existing.declaration.range.start ===
          signature.declaration.range.start &&
        existing.declaration.range.source.text ===
          signature.declaration.range.source.text
      ) {
        for (const declaration of signature.declarations) {
          existing.declarations.add(declaration);
        }
        sharedSignatures.remember(existing);
      } else if (existing.declaration !== signature.declaration) {
        existing.promotable = false;
        signature.promotable = false;
        ambiguous.add(name);
      }
    }
  }
  for (const name of ambiguous) sharedSignatures.rejectAmbiguousName(name);

  // `export` in AssemblyScript dependency code usually means "available to
  // another source module", not "part of the final WebAssembly ABI". Those
  // functions are safe to promote when the whole parsed program proves that
  // every reference is a direct call in a source we will rewrite. This keeps
  // exported library helpers optimizable without guessing about callbacks,
  // unselected dependencies, or host-visible entry points.
  for (const source of sources) {
    const scopes: FunctionContext[] = [];
    const sourceFacts = factsForSource(manifest, source);
    const globals = collectGlobalRepresentations(source, sourceFacts);
    const classes = new SourceClassTypes(source);
    if (userSources.includes(source)) {
      walk(source, (node) => {
        if (node instanceof FunctionDeclaration)
          scopes.push(
            collectLocalBindings(node, sourceFacts, classes, globals),
          );
      });
    }
    scopes.sort(
      (a, b) =>
        a.declaration!.range.end -
        a.declaration!.range.start -
        (b.declaration!.range.end - b.declaration!.range.start),
    );
    const topContext: FunctionContext = {
      declaration: null,
      globals,
      bindings: new Map(),
      parameters: new Map(),
      parameterSpans: new Map(),
      lowercaseSpans: new Set(),
      repeatedLowercaseReceivers: new Set(),
      profitableLowercaseCalls: new Set(),
      classes,
      duplicateNames: new Set(),
    };
    walk(source, (node, ref) => {
      if (!(node instanceof IdentifierExpression)) return;
      if (isDeclarationIdentifier(node, ref)) return;
      const namedSignature = sharedSignatures.get(node.text);
      if (!namedSignature) return;
      const call =
        ref.parent instanceof CallExpression && ref.parent.expression === node
          ? ref.parent
          : null;
      const context =
        (call &&
          scopes.find(
            (scope) =>
              scope.declaration!.range.start <= node.range.start &&
              scope.declaration!.range.end >= node.range.end,
          )) ||
        topContext;
      const signature = call
        ? signatureForCall(call, context, sharedSignatures)
        : namedSignature;
      if (
        !signature ||
        [...signature.declarations].some(
          (declaration) => node === declaration.name,
        )
      )
        return;
      const body = context.declaration?.body?.range;
      // Calls in defaults are counted by the planner but are outside the body
      // rewriter. A callee used there must retain its original ABI.
      const outsideBody =
        context.declaration &&
        (!body || node.range.start < body.start || node.range.end > body.end);
      if (!call || !userSources.includes(source) || outsideBody) {
        signature.promotable = false;
      } else {
        signature.directCallCount++;
        call.args.forEach((argument, index) => {
          if (
            argument instanceof CallExpression &&
            operationSemantics(propertyCall(argument)?.property.text ?? "")
              .spanProducing &&
            expressionRepresentation(
              isStrStaticCall(argument)
                ? argument.args[0]
                : propertyCall(argument)!.expression,
              context,
              sharedSignatures,
            ) !== "unknown"
          ) {
            signature.spanArgumentCounts.set(
              index,
              (signature.spanArgumentCounts.get(index) ?? 0) + 1,
            );
          }
        });
      }
    });
  }

  const sensitiveDeclarations =
    representationSensitiveDeclarations(userSources);
  for (const declaration of sensitiveDeclarations) {
    if (!(declaration instanceof FunctionDeclaration)) continue;
    const signature = sharedSignatures.forDeclaration(declaration);
    if (signature) signature.promotable = false;
  }

  // Two rounds let parameter decisions made in imported modules flow back to
  // callers that were parsed earlier. Rewrites are deliberately idempotent.
  for (let round = 0; round < 2; round++) {
    for (const source of userSources) {
      const result = optimizeSource(
        source,
        manifest,
        sharedSignatures,
        sensitiveDeclarations,
      );
      for (const changed of result.changedSources) changedSources.add(changed);
      if (round === 0) diagnostics.push(...result.diagnostics);
    }
  }
  return { changedSources, diagnostics, summary: summarize(diagnostics) };
}
