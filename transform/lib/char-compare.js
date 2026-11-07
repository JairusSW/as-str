import {
  BinaryExpression,
  CallExpression,
  ElementAccessExpression,
  FunctionDeclaration,
  IdentifierExpression,
  Node,
  StringLiteralExpression,
  SwitchStatement,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { i32Type, identifier, integer } from "./ast.js";
import { expressionRepresentation } from "./rewrite.js";
import { isDeclarationIdentifier, propertyCall, walk } from "./visitor.js";
function charRead(expression, context, signatures) {
  let receiver;
  let index;
  if (expression instanceof CallExpression) {
    const property = propertyCall(expression);
    if (
      property?.property.text !== "charAt" ||
      expression.args.length !== 1 ||
      expression.typeArguments?.length
    )
      return null;
    receiver = property.expression;
    index = expression.args[0];
  } else if (expression instanceof ElementAccessExpression) {
    receiver = expression.expression;
    index = expression.elementExpression;
  } else {
    return null;
  }
  const representation = expressionRepresentation(
    receiver,
    context,
    signatures,
  );
  if (
    representation === "native" ||
    (representation === "view" && expression instanceof CallExpression)
  )
    return { receiver, index };
  return null;
}
function unitLiteral(expression) {
  return expression instanceof StringLiteralExpression &&
    expression.value.length <= 1
    ? expression.value.length
      ? expression.value.charCodeAt(0)
      : -1
    : null;
}
function codeRead(read, expression) {
  return Node.createCallExpression(
    Node.createPropertyAccessExpression(
      read.receiver,
      identifier("charCodeAt", expression.range),
      expression.range,
    ),
    null,
    [read.index],
    expression.range,
  );
}
function isEquality(operator) {
  return (
    operator === 76 ||
    operator === 78 ||
    operator === 77 ||
    operator === 79 ||
    operator === 72 ||
    operator === 74 ||
    operator === 73 ||
    operator === 75
  );
}
function unitCases(statement) {
  const codes = [];
  for (const switchCase of statement.cases) {
    if (!switchCase.label) continue;
    const code = unitLiteral(switchCase.label);
    if (code === null) return null;
    codes.push(code);
  }
  return codes;
}
function rewriteUnitCases(statement) {
  for (const switchCase of statement.cases)
    if (switchCase.label)
      switchCase.label = integer(
        unitLiteral(switchCase.label),
        switchCase.label,
      );
}
function scalarLocals(body, declaration, context, signatures) {
  const candidates = new Map();
  for (const binding of context.bindings.values()) {
    const local = binding.declaration;
    if (
      !local.initializer ||
      context.duplicateNames.has(binding.name) ||
      local.decorators?.length
    )
      continue;
    const read = charRead(local.initializer, context, signatures);
    if (read) candidates.set(local, read);
  }
  if (!candidates.size) return new Set();
  walk(body, (node, ref) => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (
      !(node instanceof IdentifierExpression) ||
      isDeclarationIdentifier(node, ref)
    )
      return;
    const local = context.classes.declarationOf(node, context);
    if (!local || !candidates.has(local)) return;
    const parent = ref.parent;
    if (
      parent instanceof BinaryExpression &&
      isEquality(parent.operator) &&
      unitLiteral(parent.left === node ? parent.right : parent.left) !== null
    )
      return;
    if (
      parent instanceof SwitchStatement &&
      ref.key === "condition" &&
      unitCases(parent)
    )
      return;
    candidates.delete(local);
  });
  return new Set(candidates.keys());
}
export function normalizeCharComparisons(declaration, context, signatures) {
  const body = declaration.body;
  if (!body || context.representationSensitive) return false;
  const locals = scalarLocals(body, declaration, context, signatures);
  const scalar = (expression) => {
    if (!(expression instanceof IdentifierExpression)) return false;
    const local = context.classes.declarationOf(expression, context);
    return !!local && locals.has(local);
  };
  let changed = false;
  walk(body, (node) => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (node instanceof VariableDeclaration && locals.has(node)) {
      node.initializer = codeRead(
        charRead(node.initializer, context, signatures),
        node.initializer,
      );
      node.type = i32Type(node.range);
      changed = true;
      return;
    }
    if (node instanceof SwitchStatement && unitCases(node)) {
      if (scalar(node.condition)) {
        rewriteUnitCases(node);
        changed = true;
        return;
      }
      const read = charRead(node.condition, context, signatures);
      if (!read) return;
      node.condition = codeRead(read, node.condition);
      rewriteUnitCases(node);
      changed = true;
      return;
    }
    if (!(node instanceof BinaryExpression) || !isEquality(node.operator))
      return;
    const leftCode = unitLiteral(node.left);
    const rightCode = unitLiteral(node.right);
    const value = leftCode !== null ? node.right : node.left;
    const code = leftCode ?? rightCode;
    if (code === null) return;
    if (scalar(value)) {
      if (value === node.left) node.right = integer(code, node.right);
      else node.left = integer(code, node.left);
      changed = true;
      return;
    }
    const read = charRead(value, context, signatures);
    if (!read) return;
    if (value === node.left) {
      node.left = codeRead(read, value);
      node.right = integer(code, node.right);
    } else {
      node.right = codeRead(read, value);
      node.left = integer(code, node.left);
    }
    changed = true;
  });
  return changed;
}
