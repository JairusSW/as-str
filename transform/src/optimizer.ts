import {
  AssertionExpression,
  BinaryExpression,
  CallExpression,
  CommaExpression,
  CommonFlags,
  DecoratorNode,
  ElementAccessExpression,
  Expression,
  FieldDeclaration,
  FunctionDeclaration,
  IdentifierExpression,
  NewExpression,
  ParenthesizedExpression,
  PropertyAccessExpression,
  ReturnStatement,
  Source,
  Statement,
  TernaryExpression,
  ThrowStatement,
  Token,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import {
  elementRepresentationOfType,
  Representation,
  representationOfType,
  viewType,
} from "./ast.js";
import {
  isKnownViewMember,
  LENGTH_FUSIBLE_METHODS,
  VIEW_PRODUCING_METHODS,
} from "./operations.js";
import { factsForSource, SemanticFact, SemanticManifest } from "./manifest.js";
import { isPackageSource, viewNameAvailable } from "./imports.js";
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
import { rewriteDeclarationBoundaries, rewriteStatement } from "./rewrite.js";
import {
  expressionCanProduceView,
  expressionIsExplicitView,
} from "./expressions.js";

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
        diagnostic.reason.includes("profitable view")
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

function functionIsClosed(declaration: FunctionDeclaration): boolean {
  return !declaration.isAny(
    CommonFlags.Export |
      CommonFlags.Import |
      CommonFlags.Declare |
      CommonFlags.Ambient |
      CommonFlags.Public |
      CommonFlags.Override |
      CommonFlags.Closure,
  );
}

function collectFunctionSignatures(
  source: Source,
  semanticFacts: Map<string, SemanticFact>,
): Map<string, FunctionSignature> {
  const signatures = new Map<string, FunctionSignature>();
  const ambiguous = new Set<string>();

  walk(source, (node): boolean | void => {
    if (!(node instanceof FunctionDeclaration)) return;
    const name = node.name.text;
    if (signatures.has(name)) {
      ambiguous.add(name);
      return;
    }
    const annotatedResult = representationOfType(node.signature.returnType);
    signatures.set(name, {
      declaration: node,
      parameters: node.signature.parameters.map((parameter) =>
        representationOfType(parameter.type),
      ),
      result:
        annotatedResult === "unknown"
          ? (semanticFacts.get(`return:${node.range.start}`)?.representation ??
            "unknown")
          : annotatedResult,
      callable: true,
      promotable: functionIsClosed(node),
    });
  });

  for (const name of ambiguous) signatures.delete(name);

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

function parameterHasProfitableUse(body: Statement, name: string): boolean {
  let profitable = false;
  walk(body, (node, ref) => {
    if (
      node instanceof IdentifierExpression &&
      node.text === name &&
      ref.parent instanceof PropertyAccessExpression &&
      ref.key === "expression" &&
      VIEW_PRODUCING_METHODS.has(ref.parent.property.text)
    ) {
      profitable = true;
    }
  });
  return profitable;
}

function viewReceiverRoot(expression: Expression): IdentifierExpression | null {
  if (expression instanceof IdentifierExpression) return expression;
  if (expression instanceof ParenthesizedExpression) {
    return viewReceiverRoot(expression.expression);
  }
  if (expression instanceof CallExpression) {
    const property = propertyCall(expression);
    if (!property || !VIEW_PRODUCING_METHODS.has(property.property.text)) {
      return null;
    }
    return viewReceiverRoot(property.expression);
  }
  return null;
}

function analyzeParameterPromotions(
  context: FunctionContext,
  signature: FunctionSignature | undefined,
  signatures: Map<string, FunctionSignature>,
): ParameterPromotion[] {
  const declaration = context.declaration;
  if (!declaration) return [];
  const body = declaration.body;
  if (!body || !signature?.promotable) return [];
  const promotions: ParameterPromotion[] = [];

  declaration.signature.parameters.forEach((parameter, index) => {
    if (representationOfType(parameter.type) !== "native") return;
    const name = parameter.name.text;
    if (context.bindings.has(name) || !parameterHasProfitableUse(body, name)) {
      return;
    }

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
      if (!property || !VIEW_PRODUCING_METHODS.has(property.property.text)) {
        return;
      }
      if (viewReceiverRoot(property.expression)?.text !== name) return;
      reason ??= derivedViewUseReason(node, ref, context, signatures);
    });

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
  signatures: Map<string, FunctionSignature>,
): string | null {
  const parent = ref.parent;
  if (
    parent instanceof PropertyAccessExpression &&
    parent.expression === call &&
    isKnownViewMember(parent.property.text)
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
  signatures: Map<string, FunctionSignature>,
): ReturnPromotion | null {
  const declaration = context.declaration;
  const body = declaration.body;
  if (!body || !signature?.promotable || signature.result === "view")
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
  fields: Map<string, Representation>,
): FunctionContext {
  const bindings = new Map<string, Binding>();
  const parameters = new Map<string, Representation>();
  const duplicateNames = new Set<string>();
  const body = declaration.body;

  for (const parameter of declaration.signature.parameters) {
    parameters.set(parameter.name.text, representationOfType(parameter.type));
  }

  if (body) {
    walk(body, (node): boolean | void => {
      if (node instanceof FunctionDeclaration && node !== declaration)
        return false;
      if (!(node instanceof VariableDeclaration)) return;

      const name = node.name.text;
      if (bindings.has(name)) duplicateNames.add(name);
      const declared = representationOfType(node.type);
      const semantic =
        semanticFacts.get(`local:${node.range.start}`)?.representation ??
        declared;
      const noView =
        hasDecorator(node.decorators, "noView") ||
        hasLocalPragma(node, "no-view");
      const preferView =
        hasDecorator(node.decorators, "preferView") ||
        hasLocalPragma(node, "prefer-view");
      const explicitView = expressionIsExplicitView(node.initializer);
      const candidate =
        !noView &&
        !explicitView &&
        declared === "unknown" &&
        !!node.initializer &&
        (expressionCanProduceView(node.initializer) || preferView);
      bindings.set(name, {
        declaration: node,
        name,
        declared,
        semantic: explicitView ? "view" : semantic,
        decision: noView ? "native" : explicitView ? "view" : declared,
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
        spanOwner: null,
      });
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

  return { declaration, bindings, parameters, fields, duplicateNames };
}

function collectFieldRepresentations(
  source: Source,
): Map<string, Representation> {
  const fields = new Map<string, Representation>();
  const ambiguous = new Set<string>();
  walk(source, (node) => {
    if (!(node instanceof FieldDeclaration)) return;
    const representation = representationOfType(node.type);
    if (representation === "unknown") return;
    const name = node.name.text;
    if (fields.has(name)) ambiguous.add(name);
    else fields.set(name, representation);
  });
  for (const name of ambiguous) fields.delete(name);
  return fields;
}

function expectedCallArgument(
  call: CallExpression,
  index: number,
  signatures: Map<string, FunctionSignature>,
  context?: FunctionContext,
): Representation {
  if (isStrStaticCall(call)) return "view";
  const property =
    call.expression instanceof PropertyAccessExpression
      ? call.expression
      : null;
  if (
    property?.expression instanceof IdentifierExpression &&
    ["push", "unshift", "fill", "includes", "indexOf", "lastIndexOf"].includes(
      property.property.text,
    )
  ) {
    return (
      context?.bindings.get(property.expression.text)?.element ?? "unknown"
    );
  }
  const name =
    calleeName(call.expression) ??
    (property && !isKnownViewMember(property.property.text)
      ? property.property.text
      : null);
  if (!name) return "unknown";
  const signature = signatures.get(name);
  if (!signature || !signature.callable) return "unknown";
  return signature.parameters[index] ?? "unknown";
}

function reasonForUse(
  node: IdentifierExpression,
  ref: WalkRef,
  context: FunctionContext,
  signatures: Map<string, FunctionSignature>,
): string | null {
  let parent = ref.parent;
  let grandparent = ref.grandparent;

  while (parent instanceof ParenthesizedExpression) {
    grandparent = null;
    parent = parent.range === node.range ? parent : parent;
    break;
  }

  if (parent instanceof PropertyAccessExpression && ref.key === "expression") {
    return isKnownViewMember(parent.property.text)
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
        const target = context.bindings.get(parent.left.text);
        if (target?.candidate || target?.declared === "view") return null;
        return target?.declared === "native"
          ? "assignment to native string"
          : "assignment to unknown target";
      }
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
      isKnownViewMember(property.property.text)
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
  signatures: Map<string, FunctionSignature>,
): string | null {
  const parent = ref.parent;

  if (
    parent instanceof PropertyAccessExpression &&
    parent.expression === call &&
    isKnownViewMember(parent.property.text)
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
      const target = context.bindings.get(parent.left.text);
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
  const binding = context.bindings.get(root.text);
  return binding?.candidate ? binding : null;
}

function analyzeCandidates(
  context: FunctionContext,
  signatures: Map<string, FunctionSignature>,
): void {
  const declaration = context.declaration;
  if (!declaration) return;
  const body = declaration.body;
  if (!body) return;

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
    const binding = context.bindings.get(node.text);
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
    if (!property || !VIEW_PRODUCING_METHODS.has(property.property.text)) {
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
      !LENGTH_FUSIBLE_METHODS.has(initializer.property.text)
    ) {
      continue;
    }
    let onlyLengthReads = true;
    walk(body, (node, ref): boolean | void => {
      if (node instanceof FunctionDeclaration && node !== declaration)
        return false;
      if (
        !(node instanceof IdentifierExpression) ||
        node.text !== binding.name ||
        isDeclarationIdentifier(node, ref)
      ) {
        return;
      }
      if (
        !(
          ref.parent instanceof PropertyAccessExpression &&
          ref.key === "expression" &&
          ref.parent.property.text === "length"
        )
      ) {
        onlyLengthReads = false;
      }
    });
    binding.scalarizedLength = onlyLengthReads;
  }

  const spanMethods = new Set([
    "slice",
    "substring",
    "substr",
    "trim",
    "trimStart",
    "trimEnd",
    "trimLeft",
    "trimRight",
  ]);
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
      if (!initializer || !spanMethods.has(initializer.property.text)) continue;
      const receiver = isStrStaticCall(binding.declaration.initializer)
        ? binding.declaration.initializer.args[0]
        : initializer.expression;
      if (!(receiver instanceof IdentifierExpression)) continue;
      const receiverBinding = context.bindings.get(receiver.text);
      const owner = receiverBinding?.scalarizedSpan
        ? receiverBinding.spanOwner
        : receiver.text;
      if (!owner) continue;

      let scalarUsesOnly = true;
      walk(body, (node, ref): boolean | void => {
        if (node instanceof FunctionDeclaration && node !== declaration)
          return false;
        if (
          !(node instanceof IdentifierExpression) ||
          node.text !== binding.name ||
          isDeclarationIdentifier(node, ref)
        ) {
          return;
        }
        if (
          ref.parent instanceof PropertyAccessExpression &&
          ref.key === "expression"
        ) {
          if (ref.parent.property.text === "length") return;
          if (
            ref.grandparent instanceof CallExpression &&
            ref.grandparent.expression === ref.parent &&
            spanMethods.has(ref.parent.property.text)
          ) {
            const target = consumers.get(ref.grandparent);
            if (target?.scalarizedLength || target?.scalarizedSpan) return;
          }
        }
        scalarUsesOnly = false;
      });
      if (!scalarUsesOnly) continue;
      binding.scalarizedSpan = true;
      binding.spanOwner = owner;
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
      const receiverBinding = context.bindings.get(receiver.text);
      if (
        receiverBinding?.scalarizedSpan &&
        receiverBinding.spanOwner &&
        binding.spanOwner !== receiverBinding.spanOwner
      ) {
        binding.spanOwner = receiverBinding.spanOwner;
        changed = true;
      }
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

export function optimizeSource(
  source: Source,
  manifest: SemanticManifest | null = null,
  sharedSignatures: Map<string, FunctionSignature> | null = null,
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
  const signatures =
    sharedSignatures ?? collectFunctionSignatures(source, semanticFacts);
  const fields = collectFieldRepresentations(source);
  const canPromoteBoundaries = manifest?.complete !== false;

  const functions = collectFunctions(source);
  const contexts = new Map<FunctionDeclaration, FunctionContext>();
  for (const declaration of functions) {
    contexts.set(
      declaration,
      collectLocalBindings(declaration, semanticFacts, fields),
    );
  }

  rewriteDeclarationBoundaries(
    source.statements,
    {
      declaration: null,
      bindings: new Map(),
      parameters: new Map(),
      fields,
      duplicateNames: new Set(),
    },
    signatures,
  );

  // Parameter decisions precede local rewrites so call sites see final types.
  for (const declaration of functions) {
    const context = contexts.get(declaration)!;
    const signature = signatures.get(declaration.name.text);
    const promotions = canPromoteBoundaries
      ? analyzeParameterPromotions(context, signature, signatures)
      : [];
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
    const signature = signatures.get(declaration.name.text);
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

    let changed = false;
    for (const binding of context.bindings.values()) {
      if (binding.candidate && binding.decision === "view") changed = true;
    }

    // Explicit string/view conversions can be required even without promotion.
    if (
      [...context.bindings.values()].some(
        (binding) =>
          binding.declared !== "unknown" && binding.declaration.initializer,
      )
    ) {
      changed = true;
    }

    rewriteStatement(declaration.body, context, signatures);
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
    if (changed) changedSources.add(source);
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
    (source) =>
      !source.isLibrary &&
      !source.internalPath.startsWith("~lib") &&
      !isPackageSource(source) &&
      viewNameAvailable(source),
  );
  const sharedSignatures = new Map<string, FunctionSignature>();
  const ambiguous = new Set<string>();
  for (const source of userSources) {
    const sourceSignatures = collectFunctionSignatures(
      source,
      factsForSource(manifest, source),
    );
    for (const [name, signature] of sourceSignatures) {
      if (sharedSignatures.has(name)) ambiguous.add(name);
      else sharedSignatures.set(name, signature);
    }
  }
  for (const name of ambiguous) sharedSignatures.delete(name);

  // Two rounds let parameter decisions made in imported modules flow back to
  // callers that were parsed earlier. Rewrites are deliberately idempotent.
  for (let round = 0; round < 2; round++) {
    for (const source of userSources) {
      const result = optimizeSource(source, manifest, sharedSignatures);
      for (const changed of result.changedSources) changedSources.add(changed);
      if (round === 0) diagnostics.push(...result.diagnostics);
    }
  }
  return { changedSources, diagnostics, summary: summarize(diagnostics) };
}
