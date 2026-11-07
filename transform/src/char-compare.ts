import {
  BinaryExpression,
  CallExpression,
  ElementAccessExpression,
  Expression,
  FunctionDeclaration,
  IdentifierExpression,
  Node,
  StringLiteralExpression,
  SwitchStatement,
  Token,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { i32Type, identifier, integer } from "./ast.js";
import { FunctionContext } from "./model.js";
import { expressionRepresentation } from "./rewrite.js";
import { FunctionSignatures } from "./signatures.js";
import { isDeclarationIdentifier, propertyCall, walk } from "./visitor.js";

interface CharRead {
  receiver: Expression;
  index: Expression;
}

/**
 * `s.charAt(i)` and `s[i]` allocate a one-unit string, or return `""` out of
 * range. Against a literal of at most one unit the result is only ever compared,
 * so `s.charCodeAt(i)`, which returns -1 out of range, answers the same question.
 */
function charRead(
  expression: Expression,
  context: FunctionContext,
  signatures: FunctionSignatures,
): CharRead | null {
  let receiver: Expression;
  let index: Expression;
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
  // Element access on a view goes through its own operator overload.
  if (
    representation === "native" ||
    (representation === "view" && expression instanceof CallExpression)
  )
    return { receiver, index };
  return null;
}

function unitLiteral(expression: Expression): number | null {
  return expression instanceof StringLiteralExpression &&
    expression.value.length <= 1
    ? expression.value.length
      ? expression.value.charCodeAt(0)
      : -1
    : null;
}

function codeRead(read: CharRead, expression: Expression): Expression {
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

/**
 * Equality and ordering agree on code units: a one-unit string orders by its
 * unit, and the empty string, read as -1, orders before every unit.
 */
function isEquality(operator: Token): boolean {
  return (
    operator === Token.Equals_Equals ||
    operator === Token.Equals_Equals_Equals ||
    operator === Token.Exclamation_Equals ||
    operator === Token.Exclamation_Equals_Equals ||
    operator === Token.LessThan ||
    operator === Token.LessThan_Equals ||
    operator === Token.GreaterThan ||
    operator === Token.GreaterThan_Equals
  );
}

/** A switch whose cases are all literals of at most one unit, or default. */
function unitCases(statement: SwitchStatement): number[] | null {
  const codes: number[] = [];
  for (const switchCase of statement.cases) {
    if (!switchCase.label) continue;
    const code = unitLiteral(switchCase.label);
    if (code === null) return null;
    codes.push(code);
  }
  return codes;
}

function rewriteUnitCases(statement: SwitchStatement): void {
  for (const switchCase of statement.cases)
    if (switchCase.label)
      switchCase.label = integer(
        unitLiteral(switchCase.label)!,
        switchCase.label,
      );
}

/**
 * Locals whose every use is compared against a one-unit literal become the
 * code unit itself, so neither the read nor the comparisons allocate.
 */
function scalarLocals(
  body: Node,
  declaration: FunctionDeclaration,
  context: FunctionContext,
  signatures: FunctionSignatures,
): Set<VariableDeclaration> {
  const candidates = new Map<VariableDeclaration, CharRead>();
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
  walk(body, (node, ref): boolean | void => {
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

/** Rewrites one-unit string comparisons in a function to code unit reads. */
export function normalizeCharComparisons(
  declaration: FunctionDeclaration,
  context: FunctionContext,
  signatures: FunctionSignatures,
): boolean {
  const body = declaration.body;
  if (!body) return false;
  const locals = scalarLocals(body, declaration, context, signatures);
  const scalar = (expression: Expression): boolean => {
    if (!(expression instanceof IdentifierExpression)) return false;
    const local = context.classes.declarationOf(expression, context);
    return !!local && locals.has(local);
  };
  let changed = false;
  walk(body, (node): boolean | void => {
    if (node instanceof FunctionDeclaration && node !== declaration)
      return false;
    if (node instanceof VariableDeclaration && locals.has(node)) {
      node.initializer = codeRead(
        charRead(node.initializer!, context, signatures)!,
        node.initializer!,
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
    // Keep operand order: ordering operators are not symmetric.
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
