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
  ElementAccessExpression,
  ExportStatement,
  ExpressionStatement,
  ImportStatement,
  ForStatement,
  FieldDeclaration,
  FunctionDeclaration,
  FunctionExpression,
  FunctionTypeNode,
  IdentifierExpression,
  NewExpression,
  NamespaceDeclaration,
  ParenthesizedExpression,
  MethodDeclaration,
  PropertyAccessExpression,
  ReturnStatement,
  TernaryExpression,
  ThrowStatement,
  StringLiteralExpression,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import {
  elementRepresentationOfType,
  identifier,
  representationOfType,
  viewType,
  u64Type,
  generatedCalls,
  legacyNativeTrimSources,
  retainedViewSnapshots,
  generatedTypes,
  spanReturnCalls,
} from "./ast.js";
import { containerArgumentKind, operationSemantics } from "./operations.js";
import {
  isSpanLink,
  planPackedSpanParameters,
  spanChainRoot,
  spanLinkReceiver,
  spanTernary,
  splitField,
} from "./packed-span.js";
import { normalizeCharComparisons } from "./char-compare.js";
import { normalizeSplitArrays } from "./split-arrays.js";
import { factsForSource } from "./manifest.js";
import { admitSource } from "./source-admission.js";
import { isStandardSource, sourcesFor } from "./source-identity.js";
import {
  calleeName,
  isDeclarationIdentifier,
  isStrStaticCall,
  propertyCall,
  walk,
  writeTarget,
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
const MIN_PARAMETER_VIEW_BOUNDARIES = 2;
const MIN_LOCAL_VIEW_BOUNDARIES = 1;
const MIN_REUSED_LOCAL_USES = 3;
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
  const signatures = new FunctionSignatures();
  const ambiguous = new Set();
  const functions = [];
  const aliases = [];
  const references = [];
  walk(source, (node, ref) => {
    if (node instanceof FunctionDeclaration) functions.push({ node, ref });
    else if (
      node instanceof VariableDeclaration &&
      node.initializer instanceof IdentifierExpression
    )
      aliases.push(node);
    else if (node instanceof IdentifierExpression)
      references.push({ node, ref });
  });
  for (const { node, ref } of functions) {
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
      promotable:
        !(
          ref.parent instanceof FunctionExpression &&
          !(ref.grandparent instanceof ExpressionStatement)
        ) &&
        !node.signature.parameters.some(
          (parameter) => parameter.parameterKind === 2,
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
  }
  for (const name of ambiguous) signatures.rejectAmbiguousName(name);
  for (const node of aliases) {
    const target = signatures.get(node.initializer.text);
    if (!target || signatures.has(node.name.text)) continue;
    signatures.set(node.name.text, target);
  }
  for (const { node, ref } of references) {
    const signature = signatures.get(node.text);
    if (!signature || node === signature.declaration.name) continue;
    if (isDeclarationIdentifier(node, ref)) continue;
    if (
      ref.parent instanceof VariableDeclaration &&
      ref.parent.initializer === node &&
      signatures.get(ref.parent.name.text) === signature
    ) {
      continue;
    }
    if (
      !(ref.parent instanceof CallExpression && ref.parent.expression === node)
    ) {
      signature.callable = false;
      signature.promotable = false;
    }
  }
  return signatures;
}
function viewReceiverRoot(expression) {
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
function countViewBoundaryUses(body, name, context, signatures) {
  let count = 0;
  walk(body, (node, ref) => {
    if (node instanceof FunctionDeclaration && node !== context.declaration) {
      return false;
    }
    if (
      !(node instanceof IdentifierExpression) ||
      node.text !== name ||
      isDeclarationIdentifier(node, ref) ||
      !(ref.parent instanceof CallExpression) ||
      generatedCalls.has(ref.parent)
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
function analyzeParameterPromotions(context, signature, signatures) {
  const declaration = context.declaration;
  if (!declaration) return [];
  const body = declaration.body;
  if (!body || !signature?.promotable || declaration.is(2)) {
    return [];
  }
  const promotions = [];
  const spanOwners = new Set(signature.spanParameters.values());
  declaration.signature.parameters.forEach((parameter, index) => {
    if (signature.spanParameters.has(index)) return;
    if (spanOwners.has(parameter.name.text)) return;
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
function returnCallUseReason(call, ref, declaration, signatures) {
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
function analyzeReturnPromotion(context, signature, source, signatures) {
  const declaration = context.declaration;
  const body = declaration.body;
  if (
    !body ||
    !signature?.promotable ||
    signature.result === "view" ||
    signature.spanReturn !== undefined ||
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
function consumesSpan(call, parent) {
  if (parent instanceof VariableDeclaration) return parent.initializer === call;
  if (parent instanceof PropertyAccessExpression)
    return (
      parent.expression === call &&
      (parent.property.text === "length" ||
        operationSemantics(parent.property.text).spanScalar ||
        operationSemantics(parent.property.text).spanProducing)
    );
  return (
    parent instanceof BinaryExpression &&
    (parent.operator === 76 ||
      parent.operator === 77 ||
      parent.operator === 78 ||
      parent.operator === 79)
  );
}
function planSpanReturn(
  signature,
  context,
  signatures,
  sensitive,
  callParents,
) {
  const declaration = signature.declaration;
  const body = declaration.body;
  const sites = signature.callSites ?? [];
  if (
    !context ||
    !(body instanceof BlockStatement) ||
    !signature.promotable ||
    signature.declarations.size !== 1 ||
    declaration instanceof MethodDeclaration ||
    declaration.typeParameters?.length ||
    declaration.is(2) ||
    context.representationSensitive ||
    representationOfType(declaration.signature.returnType) !== "native" ||
    typeIsNullable(declaration.signature.returnType) ||
    !sites.length ||
    sites.length !== signature.directCallCount
  )
    return;
  let root = null;
  let valid = true;
  let narrows = false;
  walk(body, (node) => {
    if (node instanceof FunctionDeclaration) return false;
    if (!(node instanceof ReturnStatement)) return;
    const value = node.value;
    if (value && !(value instanceof IdentifierExpression)) narrows = true;
    const span =
      !!value &&
      (isSpanLink(value) ||
        !!spanTernary(value) ||
        value instanceof IdentifierExpression);
    const name = span ? spanChainRoot(value) : null;
    if (
      !(name instanceof IdentifierExpression) ||
      !!context.classes.declarationOf(name, context) ||
      expressionRepresentation(name, context, signatures) !== "native" ||
      (root !== null && root !== name.text)
    )
      valid = false;
    else root = name.text;
  });
  if (!valid || root === null || !narrows) return;
  const index = declaration.signature.parameters.findIndex(
    (parameter) => parameter.name.text === root,
  );
  const parameter = declaration.signature.parameters[index];
  if (
    !parameter ||
    parameter.parameterKind !== 0 ||
    parameter.initializer ||
    representationOfType(parameter.type) !== "native" ||
    typeIsNullable(parameter.type) ||
    assignsName(body, root)
  )
    return;
  for (const { call, context: caller } of sites) {
    const argument = call.args[index];
    if (
      caller.representationSensitive ||
      (caller.declaration && sensitive.has(caller.declaration)) ||
      !(
        argument instanceof StringLiteralExpression ||
        (argument instanceof IdentifierExpression &&
          expressionRepresentation(argument, caller, signatures) === "native" &&
          spanOwnerIsStable(
            { kind: "identifier", name: argument.text },
            caller,
          ))
      ) ||
      !consumesSpan(call, callParents.get(call) ?? null)
    )
      return;
  }
  signature.spanReturn = index;
  signature.result = "unknown";
  for (const { call } of sites) spanReturnCalls.set(call, index);
}
function initializerElementRepresentation(expression) {
  if (!(expression instanceof NewExpression)) return "unknown";
  const name = expression.typeName.identifier.text;
  if (name !== "Array" && name !== "StaticArray") return "unknown";
  return representationOfType(expression.typeArguments?.[0] ?? null);
}
function sameSpanOwner(left, right) {
  return left.kind === "identifier"
    ? right.kind === "identifier" && left.name === right.name
    : right.kind === "string-literal" && left.value === right.value;
}
function spanAssignment(node, ref) {
  const assignment = ref.parent;
  if (
    !(assignment instanceof BinaryExpression) ||
    assignment.operator !== 101 ||
    assignment.left !== node ||
    !(assignment.right instanceof CallExpression) ||
    !operationSemantics(propertyCall(assignment.right)?.property.text ?? "")
      .spanProducing ||
    !(
      ref.grandparent instanceof ExpressionStatement ||
      (ref.grandparent instanceof ForStatement &&
        ref.grandparent.incrementor === assignment) ||
      (ref.grandparent instanceof CommaExpression &&
        ref.grandparent.expressions.indexOf(assignment) <
          ref.grandparent.expressions.length - 1)
    )
  )
    return null;
  return assignment;
}
function spanOwnerIsStable(owner, context) {
  if (owner.kind !== "identifier") return true;
  const name = owner.name;
  if (context.duplicateNames.has(name)) return false;
  const local = context.bindings.get(name);
  const global = context.declaration
    ? context.classes.globalDeclarationOf(
        identifier(name, context.declaration.range),
        context,
      )
    : undefined;
  if (local || context.parameters.has(name)) {
    if (global) return false;
    if (local?.declaration.is(8)) return true;
    const body = context.declaration?.body;
    return (
      !!body && !(context.assignedNames?.has(name) ?? assignsName(body, name))
    );
  }
  return !!global?.is(8);
}
function assignsName(body, name) {
  let assigned = false;
  walk(body, (node) => {
    if (node instanceof FunctionDeclaration) return false;
    const target = writeTarget(node);
    if (target instanceof IdentifierExpression && target.text === name)
      assigned = true;
  });
  return assigned;
}
function collectLocalBindings(declaration, semanticFacts, classes, globals) {
  const bindings = new Map();
  const parameters = new Map();
  const duplicateNames = new Set();
  const assignedNames = new Set();
  const body = declaration.body;
  const lowercaseReceiverCounts = new Map();
  const localUseCounts = new Map();
  const profitableLowercaseCalls = new Set();
  let representationSensitive = false;
  for (const parameter of declaration.signature.parameters) {
    parameters.set(parameter.name.text, representationOfType(parameter.type));
  }
  if (body) {
    walk(body, (node) => {
      if (node instanceof FunctionDeclaration && node !== declaration)
        return false;
      const target = writeTarget(node);
      if (target instanceof IdentifierExpression)
        assignedNames.add(target.text);
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
        !(node.type && generatedTypes.has(node.type)) &&
        (declared === "unknown" || declared === "native") &&
        !!node.initializer &&
        (expressionCanProduceView(node.initializer) ||
          !!spanTernary(node.initializer) ||
          preferView);
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
    walk(body, (node) => {
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
    walk(body, (node, ref) => {
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
    walk(body, (node, ref) => {
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
    assignedNames,
  };
}
function collectGlobalRepresentations(source, facts) {
  const globals = new Map();
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
function expectedCallArgument(call, index, signatures, context) {
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
    const type = context?.classes.typeOf(property.expression, context);
    return type
      ? elementRepresentationOfType(type)
      : property.expression instanceof IdentifierExpression
        ? (context?.bindings.get(property.expression.text)?.element ??
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
function reasonForUse(node, ref, context, signatures) {
  let parent = ref.parent;
  let grandparent = ref.grandparent;
  while (parent instanceof ParenthesizedExpression) {
    grandparent = null;
    parent = parent.range === node.range ? parent : parent;
    break;
  }
  if (parent instanceof PropertyAccessExpression && ref.key === "expression") {
    if (operationSemantics(parent.property.text).container) {
      if (
        grandparent instanceof CallExpression &&
        context.inPlaceSplits?.has(grandparent)
      )
        return null;
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
    if (parent.operator === 101) {
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
      parent.operator === 76 ||
      parent.operator === 78 ||
      parent.operator === 77 ||
      parent.operator === 79
    ) {
      return null;
    }
    return "operator use";
  }
  if (
    parent instanceof TernaryExpression &&
    parent.condition !== node &&
    spanTernary(parent)
  )
    return null;
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
function derivedViewUseReason(call, ref, context, signatures) {
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
      parent.operator === 101 &&
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
  if (parent instanceof TernaryExpression) {
    const declaration = ref.grandparent;
    if (
      spanTernary(parent) &&
      declaration instanceof VariableDeclaration &&
      declaration.initializer === parent &&
      context.bindings.get(declaration.name.text)?.candidate
    )
      return null;
    return "derived view used by conditional merge";
  }
  if (parent instanceof CommaExpression) return "derived view used by comma";
  if (parent instanceof ThrowStatement) return "derived view reaches throw";
  return "derived view reaches unsupported or escaping use";
}
function candidateReceiver(expression, context) {
  const root = viewReceiverRoot(expression);
  if (!root) return null;
  const binding = context.classes.bindingOf(root, context);
  return binding?.candidate ? binding : null;
}
function analyzeCandidates(context, signatures) {
  const declaration = context.declaration;
  if (!declaration) return;
  const body = declaration.body;
  if (!body) return;
  context.inPlaceSplits = new Set();
  walk(body, (node) => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    const field = splitField(node);
    if (field) {
      context.inPlaceSplits.add(node.expression);
      return;
    }
    if (
      node instanceof PropertyAccessExpression &&
      node.property.text === "length" &&
      node.expression instanceof CallExpression &&
      !isStrStaticCall(node.expression) &&
      propertyCall(node.expression)?.property.text === "split" &&
      node.expression.args.length === 1 &&
      node.expression.args[0] instanceof StringLiteralExpression &&
      node.expression.args[0].value.length > 0
    )
      context.inPlaceSplits.add(node.expression);
  });
  const bindingUses = new Map();
  walk(body, (node, ref) => {
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
  for (const binding of context.bindings.values()) {
    const init = binding.declaration.initializer;
    if (
      binding.candidate &&
      binding.declared === "unknown" &&
      init &&
      representationOfType(context.classes.typeOf(init, context)) === "view"
    ) {
      binding.candidate = false;
      binding.semantic = "view";
      binding.decision = "view";
    }
    if (context.representationSensitive && binding.candidate)
      binding.forcedReason ??= "raw-memory or representation intrinsic";
    if (!binding.candidate || !init) continue;
    const field = splitField(init);
    const property = init instanceof CallExpression ? propertyCall(init) : null;
    const receiver = field
      ? field.receiver
      : property && !isStrStaticCall(init)
        ? property.expression
        : null;
    if (!receiver) continue;
    if (
      expressionRepresentation(spanChainRoot(receiver), context, signatures) ===
      "unknown"
    ) {
      binding.candidate = false;
      binding.decision = binding.semantic;
    }
  }
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
    const binding = context.classes.bindingOf(node, context);
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
      expressionRepresentation(spanChainRoot(receiver), context, signatures) ===
        "unknown"
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
  const scalarChains = new Set();
  const markChain = (chain) => {
    for (
      let link = chain;
      link && isSpanLink(link);
      link = spanLinkReceiver(link)
    ) {
      const call =
        link instanceof ElementAccessExpression ? link.expression : link;
      if (call instanceof CallExpression) scalarChains.add(call);
    }
  };
  walk(body, (node) => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (
      node instanceof PropertyAccessExpression &&
      node.property.text === "length"
    ) {
      markChain(node.expression);
      const split = node.expression;
      const separator = split instanceof CallExpression ? split.args[0] : null;
      if (
        split instanceof CallExpression &&
        !isStrStaticCall(split) &&
        propertyCall(split)?.property.text === "split" &&
        split.args.length === 1 &&
        separator instanceof StringLiteralExpression &&
        separator.value.length
      ) {
        scalarChains.add(split);
        markChain(propertyCall(split).expression);
      }
    } else if (node instanceof CallExpression) {
      const property = propertyCall(node);
      if (
        property &&
        !isStrStaticCall(node) &&
        operationSemantics(property.property.text).spanScalar
      )
        markChain(property.expression);
    } else if (
      node instanceof BinaryExpression &&
      (node.operator === 76 ||
        node.operator === 78 ||
        node.operator === 77 ||
        node.operator === 79)
    ) {
      if (isSpanLink(node.left)) markChain(node.left);
      else if (node.left instanceof StringLiteralExpression)
        markChain(node.right);
    }
  });
  const consumers = new Map();
  const ternaryTargets = new Map();
  const consume = (value, target) => {
    const ternary = spanTernary(value);
    if (ternary) {
      ternaryTargets.set(ternary, target);
      consume(ternary.ifThen, target);
      consume(ternary.ifElse, target);
      return;
    }
    for (
      let link = value;
      link && isSpanLink(link);
      link = spanLinkReceiver(link)
    ) {
      const call =
        link instanceof ElementAccessExpression ? link.expression : link;
      if (call instanceof CallExpression) consumers.set(call, target);
    }
  };
  for (const target of context.bindings.values()) {
    if (target.declaration.initializer) {
      consume(target.declaration.initializer, target);
    }
    for (const { node, ref } of bindingUses.get(target) ?? []) {
      const assignment = spanAssignment(node, ref);
      if (assignment) consume(assignment.right, target);
    }
  }
  const accept = (binding, optimistic) => {
    const initializer = binding.declaration.initializer;
    if (
      context.representationSensitive ||
      binding.decision !== "view" ||
      retainedViewSnapshots.has(binding.declaration) ||
      binding.scalarizedLength ||
      !initializer ||
      !(isSpanLink(initializer) || spanTernary(initializer))
    )
      return null;
    const root = spanChainRoot(initializer);
    if (
      !root ||
      expressionRepresentation(root, context, signatures) === "unknown"
    )
      return null;
    const receiverBinding =
      root instanceof IdentifierExpression
        ? context.classes.bindingOf(root, context)
        : null;
    const owner =
      receiverBinding?.scalarizedSpan && receiverBinding.packedSpan
        ? receiverBinding.packedSpan.owner
        : root instanceof IdentifierExpression
          ? { kind: "identifier", name: root.text }
          : root instanceof StringLiteralExpression
            ? { kind: "string-literal", value: root.value }
            : null;
    if (owner === null || !spanOwnerIsStable(owner, context)) return null;
    const packs = (target) =>
      !!target &&
      (target === binding ||
        target.scalarizedLength ||
        target.scalarizedSpan ||
        (optimistic && target.candidate && target.decision === "view"));
    for (const { node, ref } of bindingUses.get(binding) ?? []) {
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
          (operationSemantics(ref.parent.property.text).spanProducing ||
            ref.parent.property.text === "split") &&
          (scalarChains.has(ref.grandparent) || consumers.has(ref.grandparent))
        )
          continue;
      }
      if (
        ref.parent instanceof BinaryExpression &&
        (ref.parent.operator === 76 ||
          ref.parent.operator === 78 ||
          ref.parent.operator === 77 ||
          ref.parent.operator === 79)
      ) {
        continue;
      }
      if (
        ref.parent instanceof TernaryExpression &&
        ref.key !== "condition" &&
        packs(ternaryTargets.get(ref.parent))
      )
        continue;
      const assignment = spanAssignment(node, ref);
      if (assignment) {
        const root = spanChainRoot(assignment.right);
        const rootBinding =
          root instanceof IdentifierExpression
            ? context.classes.bindingOf(root, context)
            : null;
        const rootOwner =
          rootBinding === binding
            ? owner
            : rootBinding?.scalarizedSpan && rootBinding.packedSpan
              ? rootBinding.packedSpan.owner
              : root instanceof IdentifierExpression
                ? { kind: "identifier", name: root.text }
                : root instanceof StringLiteralExpression
                  ? { kind: "string-literal", value: root.value }
                  : null;
        if (
          rootOwner &&
          sameSpanOwner(rootOwner, owner) &&
          (rootBinding === binding ||
            expressionRepresentation(root, context, signatures) !== "unknown")
        )
          continue;
      }
      return null;
    }
    return owner;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const binding of context.bindings.values()) {
      if (binding.scalarizedSpan) continue;
      const owner = accept(binding, true);
      if (!owner) continue;
      binding.scalarizedSpan = true;
      binding.packedSpan = { owner };
      changed = true;
    }
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const binding of context.bindings.values()) {
      if (!binding.scalarizedSpan) continue;
      const owner = accept(binding, false);
      if (owner) {
        binding.packedSpan = { owner };
        continue;
      }
      binding.scalarizedSpan = false;
      binding.packedSpan = null;
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
      const receiver = spanChainRoot(
        isStrStaticCall(binding.declaration.initializer)
          ? binding.declaration.initializer.args[0]
          : parts.expression,
      );
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
      !splitField(binding.declaration.initializer) &&
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
  for (const binding of context.bindings.values()) {
    const initializer = binding.declaration.initializer;
    if (
      binding.candidate &&
      binding.decision === "view" &&
      !binding.preferred &&
      !binding.scalarizedSpan &&
      initializer &&
      spanTernary(initializer)
    ) {
      binding.decision = "native";
      binding.forcedReason = "conditional span merge is not packed";
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
function importsAny(source, paths) {
  return source.statements.some(
    (statement) =>
      (statement instanceof ImportStatement ||
        statement instanceof ExportStatement) &&
      statement.internalPath !== null &&
      paths.has(statement.internalPath),
  );
}
function mentionsAnyName(text, names) {
  if (!names.size) return false;
  for (const word of text.match(/[\p{ID_Continue}$\u200c\u200d]+/gu) ?? [])
    if (names.has(word)) return true;
  return false;
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
function trustedRepresentationSource(source) {
  return admitSource(source).packageSource || isStandardSource(source);
}
function isMemoryIntrinsic(call, target, context) {
  const parts = [];
  let expression = call.expression;
  while (
    expression instanceof PropertyAccessExpression ||
    expression instanceof ParenthesizedExpression
  ) {
    if (expression instanceof PropertyAccessExpression)
      parts.unshift(expression.property.text);
    expression = expression.expression;
  }
  if (!(expression instanceof IdentifierExpression) || !parts.length)
    return false;
  if (
    target === null ||
    (target && !isStandardSource(target.range.source)) ||
    context.parameters.has(expression.text) ||
    context.classes.declarationOf(expression, context)
  )
    return false;
  const root = expression.text;
  return (
    (root === "memory" &&
      ["fill", "copy", "init", "repeat", "compare", "atomic"].includes(
        parts[0],
      )) ||
    root === "atomic" ||
    (root === "String" &&
      ["UTF8", "UTF16"].includes(parts[0]) &&
      parts.at(-1)?.endsWith("Unsafe") === true) ||
    (["i32", "i64", "f32", "f64", "v128"].includes(root) &&
      parts.some(
        (part) =>
          part.startsWith("load") ||
          part.startsWith("store") ||
          part === "atomic",
      ))
  );
}
function representationEffects(node, context) {
  const write = writeTarget(node);
  if (
    write instanceof PropertyAccessExpression &&
    ["data", "start", "end"].includes(write.property.text)
  ) {
    const receiverType = context.classes.typeOf(write.expression, context);
    if (
      representationOfType(receiverType) === "view" ||
      !context.classes.classDeclarationOf(write.expression, context)
    )
      return { targets: [], opaque: true };
  }
  if (node instanceof PropertyAccessExpression) {
    const targets = context.classes.accessorsOf(node, context);
    return {
      targets,
      opaque: targets.some(
        (target) =>
          !target.body && !trustedRepresentationSource(target.range.source),
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
      isMemoryIntrinsic(node, target, context) ||
      !!(
        target &&
        target.name.text === "set" &&
        admitSource(target.range.source).packageSource &&
        representationOfType(target.signature.returnType) === "view"
      ) ||
      (!target && propertyCall(node)?.property.text === "set") ||
      (target
        ? !target.body && !trustedRepresentationSource(target.range.source)
        : (node.expression instanceof IdentifierExpression &&
            (context.parameters.has(node.expression.text) ||
              !!context.classes.declarationOf(node.expression, context))) ||
          context.classes.typeOf(node.expression, context) instanceof
            FunctionTypeNode),
  };
}
function representationSensitiveDeclarations(sources) {
  const contexts = new Map();
  const classesBySource = new Map();
  const ensure = (node) => {
    if (
      !(
        node instanceof ClassDeclaration ||
        (node instanceof FunctionDeclaration && node.body)
      ) ||
      contexts.has(node)
    )
      return;
    const source = node.range.source;
    if (trustedRepresentationSource(source)) return;
    let classes = classesBySource.get(source);
    if (!classes)
      classesBySource.set(source, (classes = new SourceClassTypes(source)));
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
    if (node instanceof ClassDeclaration)
      for (const member of node.members) ensure(member);
  };
  for (const source of sources) walk(source, ensure);
  const graph = new Set();
  for (const group of new Set(sources.map(sourcesFor)))
    for (const source of group) graph.add(source);
  const seeded = new Set(sources);
  for (const source of graph) {
    if (seeded.has(source) || trustedRepresentationSource(source)) continue;
    walk(source, (node) => {
      if (node instanceof ClassDeclaration) ensure(node);
    });
  }
  const sensitive = new Set();
  const callers = new Map();
  const link = (caller, callee) => {
    ensure(callee);
    const incoming = callers.get(callee) ?? new Set();
    incoming.add(caller);
    callers.set(callee, incoming);
  };
  for (const [declaration, context] of contexts) {
    const roots = [];
    if (declaration instanceof FunctionDeclaration) {
      roots.push(declaration.body);
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
      walk(root, (node) => {
        if (node instanceof FunctionDeclaration) return false;
        if (
          !(
            node instanceof CallExpression ||
            node instanceof PropertyAccessExpression ||
            node instanceof NewExpression ||
            writeTarget(node) !== null
          )
        )
          return;
        const effects = representationEffects(node, context);
        if (effects.opaque) sensitive.add(declaration);
        for (const callee of effects.targets) link(declaration, callee);
      });
  }
  for (const declaration of contexts.keys()) {
    if (!(declaration instanceof ClassDeclaration)) continue;
    const seen = new Set();
    let parent = classDeclarationOfType(declaration.extendsType);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      for (const method of declaration.members) {
        if (
          !(method instanceof FunctionDeclaration) ||
          method.is(32) ||
          method.name.text === "constructor"
        )
          continue;
        for (const base of parent.members) {
          if (
            !(base instanceof FunctionDeclaration) ||
            base.is(32) ||
            base.name.text !== method.name.text
          )
            continue;
          if (
            base.is(2048) === method.is(2048) &&
            base.is(4096) === method.is(4096)
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
function hasSensitiveCalls(node, context, sensitive) {
  let found = false;
  walk(node, (child) => {
    if (child instanceof FunctionDeclaration) return false;
    if (
      !(
        child instanceof CallExpression ||
        child instanceof PropertyAccessExpression ||
        child instanceof NewExpression ||
        writeTarget(child) !== null
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
  source,
  manifest = null,
  sharedSignatures = null,
  sensitiveDeclarations = representationSensitiveDeclarations([source]),
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
    ? new FunctionSignatures(sharedSignatures)
    : localSignatures;
  if (sharedSignatures) {
    for (const [name, local] of localSignatures) {
      const shared = sharedSignatures.forDeclaration(local.declaration);
      signatures.set(name, shared ?? local);
    }
  }
  let classes = new SourceClassTypes(source);
  const globals = collectGlobalRepresentations(source, semanticFacts);
  const canPromoteBoundaries = manifest?.complete === true;
  const functions = collectFunctions(source);
  const contexts = new Map();
  let declared = false;
  for (const declaration of functions) {
    let context = collectLocalBindings(
      declaration,
      semanticFacts,
      classes,
      globals,
    );
    context.representationSensitive ||= sensitiveDeclarations.has(declaration);
    const charsChanged = normalizeCharComparisons(
      declaration,
      context,
      signatures,
    );
    const splits = normalizeSplitArrays(
      declaration,
      context,
      signatures,
      (name) => spanOwnerIsStable({ kind: "identifier", name }, context),
    );
    declared ||= splits === "declared";
    if (charsChanged || splits) {
      changedSources.add(source);
      context = collectLocalBindings(
        declaration,
        semanticFacts,
        classes,
        globals,
      );
    }
    context.representationSensitive ||= sensitiveDeclarations.has(declaration);
    contexts.set(declaration, context);
  }
  if (declared) {
    classes = new SourceClassTypes(source);
    for (const declaration of functions)
      contexts.set(
        declaration,
        collectLocalBindings(declaration, semanticFacts, classes, globals),
      );
  }
  for (const declaration of functions) {
    const context = contexts.get(declaration);
    context.representationSensitive ||= sensitiveDeclarations.has(declaration);
    if (context.representationSensitive) {
      const signature = signatureForDeclaration(declaration, signatures);
      if (signature) signature.promotable = false;
    }
  }
  const sourceContext = {
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
  sourceContext.representationSensitive =
    functions.some((declaration) => sensitiveDeclarations.has(declaration)) ||
    hasSensitiveCalls(source, sourceContext, sensitiveDeclarations);
  const moduleOwners = [];
  sourceContext.temporaryOwners = moduleOwners;
  sourceContext.moduleConstants = moduleOwners;
  rewriteDeclarationBoundaries(source.statements, sourceContext, signatures);
  for (const context of contexts.values()) {
    recordOriginalViewReceivers(context.declaration.body, context, signatures);
  }
  for (const declaration of functions) {
    const context = contexts.get(declaration);
    const signature = signatureForDeclaration(declaration, signatures);
    if (signature?.spanReturn !== undefined) {
      context.spanReturn = signature.spanReturn;
      const range = declaration.signature.returnType.range;
      if (!generatedTypes.has(declaration.signature.returnType)) {
        const location = range.source;
        diagnostics.push({
          source: source.normalizedPath,
          line: location.lineAt(range.start),
          column: location.columnAt(),
          binding: `${declaration.name.text} return`,
          decision: "view",
          reason: `returns a packed span of ${declaration.signature.parameters[signature.spanReturn].name.text}`,
          uses: signature.directCallCount,
          conversions: 0,
        });
      }
      declaration.signature.returnType = u64Type(range);
      changedSources.add(source);
      continue;
    }
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
    const context = contexts.get(declaration);
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
    const context = contexts.get(declaration);
    analyzeCandidates(context, signatures);
    context.moduleConstants = moduleOwners;
    if (!(declaration.body instanceof BlockStatement)) {
      context.temporaryOwners = moduleOwners;
    }
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
  if (moduleOwners.length) {
    source.statements.unshift(...moduleOwners);
    changedSources.add(source);
  }
  if (sourceUsesViewName(source)) changedSources.add(source);
  return { changedSources, diagnostics, summary: summarize(diagnostics) };
}
export function optimizeSources(sources, manifest = null) {
  const changedSources = new Set();
  const diagnostics = [];
  const userSources = sources.filter(
    (source) => admitSource(source).optimization,
  );
  const nativeString = sources.find(
    (source) => source.internalPath === "~lib/string",
  );
  if (
    nativeString &&
    /offset\s*\+=\s*2\s*;\s*size\s*-=\s*2\s*;/.test(nativeString.text)
  )
    for (const source of userSources) legacyNativeTrimSources.add(source);
  const sharedSignatures = new FunctionSignatures();
  const ambiguous = new Set();
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
  const functionContexts = new Map();
  const callParents = new Map();
  const userPaths = new Set(userSources.map((source) => source.internalPath));
  const userGlobals = userSources.some((source) =>
    /@global\b/.test(source.text),
  );
  for (const source of sources) {
    const userSource = userSources.includes(source);
    if (
      !userSource &&
      ((!userGlobals && !importsAny(source, userPaths)) ||
        !mentionsAnyName(source.text, sharedSignatures))
    )
      continue;
    const scopes = [];
    const sourceFacts = factsForSource(manifest, source);
    const globals = collectGlobalRepresentations(source, sourceFacts);
    const classes = new SourceClassTypes(source);
    if (userSource) {
      walk(source, (node) => {
        if (node instanceof FunctionDeclaration) {
          const scope = collectLocalBindings(
            node,
            sourceFacts,
            classes,
            globals,
          );
          scopes.push(scope);
          functionContexts.set(node, scope);
        }
      });
    }
    scopes.sort(
      (a, b) =>
        a.declaration.range.end -
        a.declaration.range.start -
        (b.declaration.range.end - b.declaration.range.start),
    );
    const topContext = {
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
              scope.declaration.range.start <= node.range.start &&
              scope.declaration.range.end >= node.range.end,
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
      const outsideBody =
        context.declaration &&
        (!body || node.range.start < body.start || node.range.end > body.end);
      if (!call || !userSource || outsideBody) {
        signature.promotable = false;
      } else {
        signature.directCallCount++;
        (signature.callSites ??= []).push({ call, context });
        callParents.set(call, ref.grandparent);
        call.args.forEach((argument, index) => {
          if (
            argument instanceof CallExpression &&
            operationSemantics(propertyCall(argument)?.property.text ?? "")
              .spanProducing &&
            expressionRepresentation(
              isStrStaticCall(argument)
                ? argument.args[0]
                : propertyCall(argument).expression,
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
  const sensitiveDeclarations = representationSensitiveDeclarations(
    sources.filter((source) => {
      const admission = admitSource(source);
      return admission.semanticFacts && !admission.packageSource;
    }),
  );
  for (const declaration of sensitiveDeclarations) {
    if (!(declaration instanceof FunctionDeclaration)) continue;
    const signature = sharedSignatures.forDeclaration(declaration);
    if (signature) signature.promotable = false;
  }
  if (manifest?.complete === true)
    for (const signature of new Set(sharedSignatures.values()))
      planSpanReturn(
        signature,
        functionContexts.get(signature.declaration),
        sharedSignatures,
        sensitiveDeclarations,
        callParents,
      );
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
