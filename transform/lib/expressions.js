import {
  CallExpression,
  ElementAccessExpression,
  IdentifierExpression,
  ParenthesizedExpression,
  StringLiteralExpression,
  TernaryExpression,
} from "assemblyscript/dist/assemblyscript.js";
import { spanReturnCalls } from "./ast.js";
import { operationSemantics } from "./operations.js";
import { calleeName, propertyCall } from "./visitor.js";
export function expressionCanProduceView(expression) {
  if (!expression) return false;
  if (expression instanceof ParenthesizedExpression) {
    return expressionCanProduceView(expression.expression);
  }
  if (expression instanceof TernaryExpression) {
    return (
      expressionCanProduceView(expression.ifThen) &&
      expressionCanProduceView(expression.ifElse)
    );
  }
  if (expression instanceof ElementAccessExpression) {
    const split = expression.expression;
    return (
      split instanceof CallExpression &&
      propertyCall(split)?.property.text === "split" &&
      split.args.length === 1 &&
      split.args[0] instanceof StringLiteralExpression &&
      split.args[0].value.length > 0
    );
  }
  if (!(expression instanceof CallExpression)) return false;
  if (spanReturnCalls.has(expression)) return true;
  if (calleeName(expression.expression) === "str") return true;
  const property = propertyCall(expression);
  if (!property) return false;
  if (
    property.expression instanceof IdentifierExpression &&
    property.expression.text === "str"
  ) {
    return (
      property.property.text === "from" ||
      operationSemantics(property.property.text).result === "view"
    );
  }
  return operationSemantics(property.property.text).result === "view";
}
export function expressionIsExplicitView(expression) {
  if (!expression) return false;
  if (expression instanceof ParenthesizedExpression) {
    return expressionIsExplicitView(expression.expression);
  }
  if (!(expression instanceof CallExpression)) return false;
  if (calleeName(expression.expression) === "str") return true;
  const property = propertyCall(expression);
  return (
    !!property &&
    property.expression instanceof IdentifierExpression &&
    property.expression.text === "str" &&
    (property.property.text === "from" ||
      operationSemantics(property.property.text).result === "view")
  );
}
