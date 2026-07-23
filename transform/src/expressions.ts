import {
  CallExpression,
  Expression,
  IdentifierExpression,
  ParenthesizedExpression,
  TernaryExpression,
} from "assemblyscript/dist/assemblyscript.js";
import { operationSemantics } from "./operations.js";
import { calleeName, propertyCall } from "./visitor.js";

export function expressionCanProduceView(
  expression: Expression | null,
): boolean {
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
  if (!(expression instanceof CallExpression)) return false;
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

export function expressionIsExplicitView(
  expression: Expression | null,
): boolean {
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
