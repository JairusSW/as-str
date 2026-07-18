import {
  AssertionExpression,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ClassDeclaration,
  CommaExpression,
  DoStatement,
  ElementAccessExpression,
  ExpressionStatement,
  FieldDeclaration,
  ForOfStatement,
  ForStatement,
  IdentifierExpression,
  IfStatement,
  NamespaceDeclaration,
  ParenthesizedExpression,
  PropertyAccessExpression,
  ReturnStatement,
  StringLiteralExpression,
  SwitchStatement,
  TernaryExpression,
  ThrowStatement,
  TryStatement,
  UnaryPostfixExpression,
  UnaryPrefixExpression,
  VariableStatement,
  WhileStatement,
} from "assemblyscript/dist/assemblyscript.js";
import {
  identifier,
  materializeView,
  i32Type,
  representationOfType,
  staticViewCall,
  u64Type,
  viewType,
  wrapAsView,
} from "./ast.js";
import {
  isKnownViewMember,
  LENGTH_FUSIBLE_METHODS,
  NATIVE_PRODUCING_METHODS,
  SCALAR_MEMBERS,
  VIEW_PRODUCING_METHODS,
} from "./operations.js";
import { expressionCanProduceView } from "./expressions.js";
import { calleeName, isStrStaticCall, propertyCall } from "./visitor.js";
function viewCallParts(expression) {
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
function normalizedSpanMethod(method) {
  return method === "trimLeft"
    ? "trimStart"
    : method === "trimRight"
      ? "trimEnd"
      : method;
}
function scalarizeSpanInitializer(expression, context) {
  const parts = viewCallParts(expression);
  if (!parts) return expression;
  const method = normalizedSpanMethod(parts.method);
  if (
    parts.receiver instanceof IdentifierExpression &&
    context.bindings.get(parts.receiver.text)?.scalarizedSpan
  ) {
    return staticViewCall(`${method}SpanOf`, parts.receiver, parts.args);
  }
  return staticViewCall(`${method}Span`, parts.receiver, parts.args);
}
function scalarizeLengthInitializer(expression, context) {
  const parts = viewCallParts(expression);
  if (!parts || !LENGTH_FUSIBLE_METHODS.has(parts.method)) return expression;
  if (
    parts.receiver instanceof IdentifierExpression &&
    context.bindings.get(parts.receiver.text)?.scalarizedSpan
  ) {
    const receiver = context.bindings.get(parts.receiver.text);
    const owner = receiver.spanOwner;
    const span = staticViewCall(
      `${normalizedSpanMethod(parts.method)}SpanOf`,
      parts.receiver,
      parts.args,
    );
    return staticViewCall("spanLength", identifier(owner, expression.range), [
      span,
    ]);
  }
  return staticViewCall(`${parts.method}Length`, parts.receiver, parts.args);
}
function bindingRepresentation(name, context) {
  const binding = context.bindings.get(name);
  if (!binding) return context.parameters.get(name) ?? "unknown";
  if (binding.decision !== "unknown") return binding.decision;
  return binding.declared === "unknown" ? binding.semantic : binding.declared;
}
function expressionRepresentation(expression, context, signatures) {
  if (expression instanceof ParenthesizedExpression) {
    return expressionRepresentation(expression.expression, context, signatures);
  }
  if (expression instanceof StringLiteralExpression) return "native";
  if ("literalKind" in expression && expression.literalKind === 3) {
    return "native";
  }
  if (expression instanceof IdentifierExpression) {
    return bindingRepresentation(expression.text, context);
  }
  if (expression instanceof PropertyAccessExpression) {
    return context.fields.get(expression.property.text) ?? "unknown";
  }
  if (
    expression instanceof ElementAccessExpression &&
    expression.expression instanceof IdentifierExpression
  ) {
    return (
      context.bindings.get(expression.expression.text)?.element ?? "unknown"
    );
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
        VIEW_PRODUCING_METHODS.has(property.property.text)
      ) {
        return "view";
      }
      if (NATIVE_PRODUCING_METHODS.has(property.property.text)) return "native";
    }
    if (VIEW_PRODUCING_METHODS.has(property.property.text)) {
      return expressionRepresentation(
        property.expression,
        context,
        signatures,
      ) === "view"
        ? "view"
        : "native";
    }
    if (NATIVE_PRODUCING_METHODS.has(property.property.text)) return "native";
  }
  const name = calleeName(expression.expression);
  return name ? (signatures.get(name)?.result ?? "unknown") : "unknown";
}
function convertExpression(expression, expected, context, signatures) {
  if (
    expression instanceof PropertyAccessExpression &&
    expression.property.text === "length" &&
    expression.expression instanceof CallExpression
  ) {
    const call = expression.expression;
    const property = propertyCall(call);
    if (property && LENGTH_FUSIBLE_METHODS.has(property.property.text)) {
      return rewriteExpression(
        scalarizeLengthInitializer(call, context),
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
      const argumentCall =
        argument instanceof CallExpression ? propertyCall(argument) : null;
      if (
        argument instanceof CallExpression &&
        argumentCall?.property.text === "toString" &&
        argument.args.length === 0 &&
        expressionRepresentation(
          argumentCall.expression,
          context,
          signatures,
        ) === "view"
      ) {
        return convertExpression(
          argumentCall.expression,
          expected,
          context,
          signatures,
        );
      }
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
      if (
        expected === "view" &&
        expressionRepresentation(property.expression, context, signatures) ===
          "view"
      ) {
        return property.expression;
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
  if (expected === "native" && actual === "view") {
    if (expression instanceof IdentifierExpression) {
      const binding = context.bindings.get(expression.text);
      if (binding) binding.conversions++;
    }
    return materializeView(expression);
  }
  return expression;
}
function rewriteExpression(expression, expected, context, signatures) {
  if (
    expression instanceof PropertyAccessExpression &&
    expression.property.text === "length" &&
    expression.expression instanceof IdentifierExpression &&
    context.bindings.get(expression.expression.text)?.scalarizedLength
  ) {
    return expression.expression;
  }
  if (
    expression instanceof PropertyAccessExpression &&
    expression.property.text === "length" &&
    expression.expression instanceof IdentifierExpression
  ) {
    const binding = context.bindings.get(expression.expression.text);
    if (binding?.scalarizedSpan && binding.spanOwner) {
      return staticViewCall(
        "spanLength",
        identifier(binding.spanOwner, expression.range),
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
    return expression;
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
    if (expression.operator === 101) {
      let target = "unknown";
      if (expression.left instanceof IdentifierExpression) {
        target = bindingRepresentation(expression.left.text, context);
      } else if (expression.left instanceof PropertyAccessExpression) {
        target = context.fields.get(expression.left.property.text) ?? "unknown";
      } else if (
        expression.left instanceof ElementAccessExpression &&
        expression.left.expression instanceof IdentifierExpression
      ) {
        target =
          context.bindings.get(expression.left.expression.text)?.element ??
          "unknown";
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
      const containerElement =
        property.expression instanceof IdentifierExpression
          ? (context.bindings.get(property.expression.text)?.element ??
            "unknown")
          : "unknown";
      let receiverExpected = "unknown";
      if (
        expressionCanProduceView(property.expression) &&
        (VIEW_PRODUCING_METHODS.has(method) || SCALAR_MEMBERS.has(method))
      ) {
        receiverExpected = "view";
      }
      property.expression = rewriteExpression(
        property.expression,
        receiverExpected,
        context,
        signatures,
      );
      expression.args = expression.args.map((argument, index) =>
        rewriteExpression(
          argument,
          [
            "push",
            "unshift",
            "fill",
            "includes",
            "indexOf",
            "lastIndexOf",
          ].includes(method)
            ? containerElement
            : isKnownViewMember(method)
              ? "unknown"
              : (signatures.get(method)?.parameters[index] ?? "unknown"),
          context,
          signatures,
        ),
      );
      if (VIEW_PRODUCING_METHODS.has(method) && expected === "view") {
        const receiverRep = expressionRepresentation(
          property.expression,
          context,
          signatures,
        );
        if (receiverRep !== "view") {
          return staticViewCall(method, property.expression, expression.args);
        }
      }
    } else {
      const name = calleeName(expression.expression);
      const signature = name ? signatures.get(name) : null;
      expression.args = expression.args.map((argument, index) =>
        rewriteExpression(
          argument,
          signature?.callable
            ? (signature.parameters[index] ?? "unknown")
            : "unknown",
          context,
          signatures,
        ),
      );
    }
    return convertExpression(expression, expected, context, signatures);
  }
  if (expression instanceof PropertyAccessExpression) {
    const receiverExpected =
      SCALAR_MEMBERS.has(expression.property.text) &&
      expressionCanProduceView(expression.expression)
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
      expressionCanProduceView(expression.expression) ? "view" : "unknown",
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
  return convertExpression(expression, expected, context, signatures);
}
export function rewriteStatement(statement, context, signatures) {
  if (statement instanceof BlockStatement) {
    for (const child of statement.statements) {
      rewriteStatement(child, context, signatures);
    }
    return;
  }
  if (statement instanceof VariableStatement) {
    for (const declaration of statement.declarations) {
      const binding = context.bindings.get(declaration.name.text);
      if (
        binding?.scalarizedLength &&
        declaration.initializer instanceof CallExpression
      ) {
        declaration.type = i32Type(declaration.range);
        declaration.initializer = rewriteExpression(
          scalarizeLengthInitializer(declaration.initializer, context),
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
          scalarizeSpanInitializer(declaration.initializer, context),
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
export function rewriteDeclarationBoundaries(statements, context, signatures) {
  for (const statement of statements) {
    if (statement instanceof VariableStatement) {
      for (const declaration of statement.declarations) {
        if (!declaration.initializer) continue;
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
        member.initializer = rewriteExpression(
          member.initializer,
          representationOfType(member.type),
          context,
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
