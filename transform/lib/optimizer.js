import {
  AssertionExpression,
  BinaryExpression,
  CallExpression,
  ClassDeclaration,
  CommaExpression,
  ElementAccessExpression,
  FieldDeclaration,
  FunctionDeclaration,
  IdentifierExpression,
  NewExpression,
  Node,
  ParenthesizedExpression,
  PropertyAccessExpression,
  ReturnStatement,
  StringLiteralExpression,
  TernaryExpression,
  ThrowStatement,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import {
  elementRepresentationOfType,
  identifier,
  representationOfType,
  u64Type,
  viewType,
} from "./ast.js";
import {
  isKnownViewMember,
  LENGTH_FUSIBLE_METHODS,
  SPAN_PRODUCING_METHODS,
  SPAN_SCALAR_METHODS,
  VIEW_CONTAINER_METHODS,
  VIEW_PRODUCING_METHODS,
} from "./operations.js";
import { factsForSource } from "./manifest.js";
import { isPackageSource, viewNameAvailable } from "./imports.js";
import {
  calleeName,
  isDeclarationIdentifier,
  isStrStaticCall,
  propertyCall,
  walk,
} from "./visitor.js";
import { rewriteDeclarationBoundaries, rewriteStatement } from "./rewrite.js";
import {
  expressionCanProduceView,
  expressionIsExplicitView,
} from "./expressions.js";
import { sourceIsOptimizable } from "./sources.js";
function summarize(diagnostics) {
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
function decoratorName(decorator) {
  const name = decorator.name;
  return name instanceof IdentifierExpression ? name.text : null;
}
function hasDecorator(decorators, expected) {
  return !!decorators?.some(
    (decorator) => decoratorName(decorator) === expected,
  );
}
function hasLocalPragma(declaration, pragma) {
  const text = declaration.range.source.text;
  const lineStart = text.lastIndexOf("\n", declaration.range.start - 1) + 1;
  if (lineStart <= 0) return false;
  const previousEnd = lineStart - 1;
  const previousStart = text.lastIndexOf("\n", previousEnd - 1) + 1;
  return (
    text.slice(previousStart, previousEnd).trim() === `// @as-str ${pragma}`
  );
}
function isUnsafeIntrinsic(call) {
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
function functionIsClosed(declaration, owner) {
  if (declaration.is(2) && !declaration.range.source.isLibrary) {
    return false;
  }
  return !owner && !declaration.isAny(1 | 4 | 32768 | 256 | 8192 | 536870912);
}
function collectFunctionSignatures(source, semanticFacts) {
  const signatures = new Map();
  const ambiguous = new Set();
  walk(source, (node, ref) => {
    if (!(node instanceof FunctionDeclaration)) return;
    const name = node.name.text;
    if (signatures.has(name)) {
      ambiguous.add(name);
      return;
    }
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
      promotable: functionIsClosed(
        node,
        ref.parent instanceof ClassDeclaration ? ref.parent : null,
      ),
      viewArgumentParameters: new Set(),
      spanArgumentCounts: new Map(),
      directCallCount: 0,
      spanParameters: new Map(),
      caseInsensitiveSpanParameters: new Set(),
      spanAppliedDeclarations: new Set(),
    });
  });
  for (const name of ambiguous) signatures.delete(name);
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
function parameterHasProfitableUse(body, name) {
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
        SPAN_SCALAR_METHODS.has(member) &&
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
function selectPackedSpanParameters(context, signature) {
  const declaration = context.declaration;
  const body = declaration?.body;
  if (!declaration || !body || !signature?.promotable) return;
  if (signature.directCallCount === 0) return;
  declaration.signature.parameters.forEach((parameter, index) => {
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
function applyPackedSpanParameters(context, signature) {
  const declaration = context.declaration;
  if (signature.spanAppliedDeclarations.has(declaration)) return;
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
}
function viewReceiverRoot(expression) {
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
function analyzeParameterPromotions(context, signature, signatures) {
  const declaration = context.declaration;
  if (!declaration) return [];
  const body = declaration.body;
  if (!body || !signature?.promotable || declaration.is(2)) {
    return [];
  }
  const promotions = [];
  declaration.signature.parameters.forEach((parameter, index) => {
    if (signature.spanParameters.has(index)) return;
    if (representationOfType(parameter.type) !== "native") return;
    const name = parameter.name.text;
    if (
      context.bindings.has(name) ||
      (!parameterHasProfitableUse(body, name) &&
        !signature.viewArgumentParameters.has(index))
    ) {
      return;
    }
    let reason = null;
    let uses = 0;
    walk(body, (node, ref) => {
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
    walk(body, (node, ref) => {
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
function returnCallUseReason(call, ref, declaration, signatures) {
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
function analyzeReturnPromotion(context, signature, source, signatures) {
  const declaration = context.declaration;
  const body = declaration.body;
  if (
    !body ||
    !signature?.promotable ||
    signature.result === "view" ||
    declaration.is(2)
  )
    return null;
  let profitable = false;
  let hasValueReturn = false;
  walk(body, (node) => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (node instanceof ReturnStatement && node.value) {
      hasValueReturn = true;
      if (expressionCanProduceView(node.value)) profitable = true;
    }
  });
  if (!hasValueReturn || !profitable) return null;
  let reason = null;
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
function initializerElementRepresentation(expression) {
  if (!(expression instanceof NewExpression)) return "unknown";
  const name = expression.typeName.identifier.text;
  if (name !== "Array" && name !== "StaticArray") return "unknown";
  return representationOfType(expression.typeArguments?.[0] ?? null);
}
function collectLocalBindings(declaration, semanticFacts, fields) {
  const bindings = new Map();
  const parameters = new Map();
  const duplicateNames = new Set();
  const body = declaration.body;
  for (const parameter of declaration.signature.parameters) {
    parameters.set(parameter.name.text, representationOfType(parameter.type));
  }
  if (body) {
    walk(body, (node) => {
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
        (declared === "unknown" || declared === "native") &&
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
  return {
    declaration,
    bindings,
    parameters,
    parameterSpans: new Map(),
    caseInsensitiveSpans: new Set(),
    fields,
    duplicateNames,
  };
}
function collectFieldRepresentations(source) {
  const fields = new Map();
  const ambiguous = new Set();
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
function expectedCallArgument(call, index, signatures, context) {
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
function reasonForUse(node, ref, context, signatures) {
  let parent = ref.parent;
  let grandparent = ref.grandparent;
  while (parent instanceof ParenthesizedExpression) {
    grandparent = null;
    parent = parent.range === node.range ? parent : parent;
    break;
  }
  if (parent instanceof PropertyAccessExpression && ref.key === "expression") {
    if (VIEW_CONTAINER_METHODS.has(parent.property.text)) {
      return `view container result from .${parent.property.text} is not yet modeled`;
    }
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
    if (parent.operator === 101) {
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
    if (
      parent.operator === 76 ||
      parent.operator === 78 ||
      parent.operator === 77 ||
      parent.operator === 79
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
      isKnownViewMember(property.property.text)
    ) {
      return null;
    }
  }
  return "unsupported or escaping use";
}
function derivedViewUseReason(call, ref, context, signatures) {
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
      parent.operator === 101 &&
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
function candidateReceiver(expression, context) {
  const root = viewReceiverRoot(expression);
  if (!root) return null;
  const binding = context.bindings.get(root.text);
  return binding?.candidate ? binding : null;
}
function analyzeCandidates(context, signatures) {
  const declaration = context.declaration;
  if (!declaration) return;
  const body = declaration.body;
  if (!body) return;
  walk(body, (node, ref) => {
    if (node instanceof FunctionDeclaration && node !== declaration) {
      walk(node.body, (nested) => {
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
  walk(body, (node, ref) => {
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
    walk(body, (node, ref) => {
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
  const consumers = new Map();
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
        !SPAN_PRODUCING_METHODS.has(initializer.property.text)
      )
        continue;
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
      walk(body, (node, ref) => {
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
          if (
            ref.parent.property.text === "length" ||
            ref.parent.property.text === "isEmpty"
          ) {
            return;
          }
          if (
            ref.grandparent instanceof CallExpression &&
            ref.grandparent.expression === ref.parent &&
            SPAN_SCALAR_METHODS.has(ref.parent.property.text)
          ) {
            return;
          }
          if (
            ref.grandparent instanceof CallExpression &&
            ref.grandparent.expression === ref.parent &&
            SPAN_PRODUCING_METHODS.has(ref.parent.property.text)
          ) {
            const target = consumers.get(ref.grandparent);
            if (target?.scalarizedLength || target?.scalarizedSpan) return;
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
function diagnosticFor(binding) {
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
function collectFunctions(source) {
  const functions = [];
  walk(source, (node) => {
    if (node instanceof FunctionDeclaration && node.body) functions.push(node);
  });
  return functions;
}
function sourceUsesViewName(source) {
  let usesView = false;
  walk(source, (node) => {
    if (node instanceof IdentifierExpression && node.text === "str") {
      usesView = true;
      return false;
    }
  });
  return usesView;
}
export function optimizeSource(
  source,
  manifest = null,
  sharedSignatures = null,
) {
  const changedSources = new Set();
  const diagnostics = [];
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
    ? new Map(sharedSignatures)
    : localSignatures;
  if (sharedSignatures) {
    for (const [name, local] of localSignatures) {
      const shared = sharedSignatures.get(name);
      if (!shared || !shared.declarations.has(local.declaration)) {
        signatures.set(name, local);
      }
    }
  }
  const fields = collectFieldRepresentations(source);
  const canPromoteBoundaries = manifest?.complete === true;
  const functions = collectFunctions(source);
  const contexts = new Map();
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
      parameterSpans: new Map(),
      caseInsensitiveSpans: new Set(),
      fields,
      duplicateNames: new Set(),
    },
    signatures,
  );
  for (const declaration of functions) {
    const context = contexts.get(declaration);
    const signature = signatures.get(declaration.name.text);
    if (canPromoteBoundaries) {
      selectPackedSpanParameters(context, signature);
    }
    const promotions = canPromoteBoundaries
      ? analyzeParameterPromotions(context, signature, signatures)
      : [];
    if (signature && signature.spanParameters.size > 0) {
      applyPackedSpanParameters(context, signature);
      changedSources.add(source);
    }
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
    const context = contexts.get(declaration);
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
    const context = contexts.get(declaration);
    analyzeCandidates(context, signatures);
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
  }
  if (sourceUsesViewName(source)) changedSources.add(source);
  return { changedSources, diagnostics, summary: summarize(diagnostics) };
}
export function optimizeSources(sources, manifest = null) {
  const changedSources = new Set();
  const diagnostics = [];
  const userSources = sources.filter(
    (source) =>
      sourceIsOptimizable(source) &&
      !isPackageSource(source) &&
      viewNameAvailable(source),
  );
  const sharedSignatures = new Map();
  const ambiguous = new Set();
  for (const source of userSources) {
    const sourceSignatures = collectFunctionSignatures(
      source,
      factsForSource(manifest, source),
    );
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
      } else if (existing.declaration !== signature.declaration) {
        ambiguous.add(name);
      }
    }
  }
  for (const name of ambiguous) sharedSignatures.delete(name);
  for (const source of sources) {
    walk(source, (node, ref) => {
      if (!(node instanceof IdentifierExpression)) return;
      const signature = sharedSignatures.get(node.text);
      if (
        !signature ||
        [...signature.declarations].some(
          (declaration) => node === declaration.name,
        )
      ) {
        return;
      }
      if (isDeclarationIdentifier(node, ref)) return;
      const call =
        ref.parent instanceof CallExpression && ref.parent.expression === node
          ? ref.parent
          : null;
      if (!call || !userSources.includes(source)) {
        signature.promotable = false;
      } else {
        signature.directCallCount++;
        call.args.forEach((argument, index) => {
          if (expressionCanProduceView(argument)) {
            signature.viewArgumentParameters.add(index);
          }
          if (
            argument instanceof CallExpression &&
            SPAN_PRODUCING_METHODS.has(
              propertyCall(argument)?.property.text ?? "",
            )
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
  for (let round = 0; round < 2; round++) {
    for (const source of userSources) {
      const result = optimizeSource(source, manifest, sharedSignatures);
      for (const changed of result.changedSources) changedSources.add(changed);
      if (round === 0) diagnostics.push(...result.diagnostics);
    }
  }
  return { changedSources, diagnostics, summary: summarize(diagnostics) };
}
