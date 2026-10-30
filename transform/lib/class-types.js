import {
  AssertionExpression,
  BlockStatement,
  ExpressionStatement,
  ElementAccessExpression,
  ClassDeclaration,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  FunctionTypeNode,
  FieldDeclaration,
  ForStatement,
  ForOfStatement,
  IdentifierExpression,
  NamespaceDeclaration,
  NamedTypeNode,
  NewExpression,
  Node,
  ParenthesizedExpression,
  PropertyAccessExpression,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { representationOfType, typeName } from "./ast.js";
import { walk } from "./visitor.js";
export class SourceClassTypes {
  classes = new Map();
  owners = new Map();
  namespaces = [];
  ambiguous = new Set();
  globals = new Map();
  functions = new Map();
  variables = new Map();
  lexicalFunctions = [];
  constructor(source) {
    walk(source, (node) => {
      if (!(node instanceof NamespaceDeclaration)) return;
      const scope = this.namespaceAt(node.range.start);
      this.namespaces.push({
        name: scope ? `${scope}.${node.name.text}` : node.name.text,
        start: node.range.start,
        end: node.range.end,
      });
    });
    walk(source, (node, ref) => {
      if (node instanceof VariableDeclaration) {
        const scope = ref.grandparent;
        if (
          scope instanceof BlockStatement ||
          scope instanceof ForStatement ||
          scope instanceof ForOfStatement
        ) {
          const list = this.variables.get(node.name.text) ?? [];
          list.push({ declaration: node, scope });
          this.variables.set(node.name.text, list);
        }
      }
      if (
        !(node instanceof VariableDeclaration) ||
        (ref.grandparent !== source &&
          !(ref.grandparent instanceof NamespaceDeclaration))
      )
        return;
      const scope = this.namespaceAt(node.range.start);
      this.globals.set(
        scope ? `${scope}.${node.name.text}` : node.name.text,
        node,
      );
    });
    walk(source, (node, ref) => {
      if (
        node instanceof FunctionExpression &&
        ref.parent instanceof ExpressionStatement &&
        ref.grandparent instanceof BlockStatement
      )
        this.lexicalFunctions.push({
          declaration: node.declaration,
          scope: ref.grandparent,
        });
      if (
        !(node instanceof FunctionDeclaration) ||
        (ref.parent !== source && !(ref.parent instanceof NamespaceDeclaration))
      )
        return;
      const scope = this.namespaceAt(node.range.start);
      const name = scope ? `${scope}.${node.name.text}` : node.name.text;
      this.functions.set(name, this.functions.has(name) ? null : node);
    });
    walk(source, (node) => {
      if (!(node instanceof ClassDeclaration)) return;
      const scope = this.namespaceAt(node.range.start);
      const owner = scope ? `${scope}.${node.name.text}` : node.name.text;
      if (this.classes.has(owner)) this.ambiguous.add(owner);
      const properties = new Map();
      const methods = new Map();
      this.owners.set(node, owner);
      for (const member of node.members) {
        this.owners.set(member, owner);
        const key = member.is(32)
          ? `static:${member.name.text}`
          : member.name.text;
        if (member instanceof FieldDeclaration) {
          properties.set(key, {
            declaration: member,
            type: member.type,
            initializer: member.initializer,
            representation: properties.has(key)
              ? "unknown"
              : representationOfType(member.type),
          });
        } else if (member instanceof FunctionDeclaration) {
          if (member.isAny(2048 | 4096)) {
            const getter = member.is(2048);
            const type = getter
              ? member.signature.returnType
              : (member.signature.parameters[0]?.type ?? null);
            if (getter || !properties.has(key))
              properties.set(key, {
                declaration: member,
                type,
                initializer: null,
                representation: representationOfType(type),
              });
          } else methods.set(key, methods.has(key) ? null : member);
        }
      }
      this.classes.set(owner, {
        declaration: node,
        properties,
        methods,
      });
    });
    const done = new Set(),
      visiting = new Set();
    const inherit = (owner) => {
      if (done.has(owner) || visiting.has(owner)) return;
      const info = this.classes.get(owner);
      if (!info) return;
      visiting.add(owner);
      const base = typeName(info.declaration.extendsType);
      const parent = base
        ? this.resolve(base, info.declaration.range.start)
        : null;
      if (!this.ambiguous.has(owner) && parent && !this.ambiguous.has(parent)) {
        inherit(parent);
        for (const [name, property] of this.classes.get(parent).properties) {
          if (!info.properties.has(name)) info.properties.set(name, property);
        }
        for (const [name, method] of this.classes.get(parent).methods) {
          if (!info.methods.has(name)) info.methods.set(name, method);
        }
      }
      visiting.delete(owner);
      done.add(owner);
    };
    for (const owner of this.classes.keys()) inherit(owner);
  }
  ownerOf(declaration) {
    return this.owners.get(declaration);
  }
  declarationOf(expression, context) {
    return this.localVariable(expression.text, expression.range.start, context);
  }
  propertyOf(expression, context) {
    return this.propertyInfo(expression, context)?.representation ?? "unknown";
  }
  typeOf(expression, context) {
    return this.declaredType(expression, context, new Set());
  }
  declaredType(expression, context, seen, globalScope = false) {
    if (seen.has(expression)) return null;
    seen.add(expression);
    if (
      expression instanceof ParenthesizedExpression ||
      (expression instanceof AssertionExpression &&
        expression.assertionKind === 2)
    )
      return this.declaredType(
        expression.expression,
        context,
        seen,
        globalScope,
      );
    if (expression instanceof AssertionExpression) return expression.toType;
    if (expression instanceof NewExpression)
      return Node.createNamedType(
        expression.typeName,
        expression.typeArguments,
        false,
        expression.range,
      );
    if (expression instanceof FunctionExpression)
      return expression.declaration.signature;
    if (expression instanceof IdentifierExpression && !globalScope) {
      const variable = this.localVariable(
        expression.text,
        expression.range.start,
        context,
      );
      if (variable)
        return (
          variable.type ??
          (variable.initializer
            ? this.declaredType(variable.initializer, context, seen)
            : null)
        );
      const parameter = context.declaration?.signature.parameters.find(
        (p) => p.name.text === expression.text,
      );
      if (parameter) return parameter.type;
      if (context.parameters.has(expression.text)) return null;
    }
    if (expression instanceof PropertyAccessExpression) {
      const property = this.propertyInfo(
        expression,
        context,
        seen,
        globalScope,
      );
      if (property) return property.type;
    }
    if (expression instanceof ElementAccessExpression) {
      const array = this.declaredType(
        expression.expression,
        context,
        seen,
        globalScope,
      );
      return array instanceof NamedTypeNode &&
        ["Array", "StaticArray"].includes(typeName(array) ?? "")
        ? (array.typeArguments?.[0] ?? null)
        : null;
    }
    if (expression instanceof CallExpression) {
      const declaration = this.callableOf(expression.expression, context);
      if (declaration) return declaration.signature.returnType;
      const callback = this.declaredType(
        expression.expression,
        context,
        seen,
        globalScope,
      );
      return callback instanceof FunctionTypeNode ? callback.returnType : null;
    }
    const path = this.unshadowedPath(expression, context, globalScope);
    const key = path ? this.runtimeKey(path, expression.range.start) : null;
    const variable = key ? this.globals.get(key) : null;
    return (
      variable?.type ??
      (variable?.initializer
        ? this.declaredType(
            variable.initializer,
            {
              ...context,
              declaration: null,
              bindings: new Map(),
              parameters: new Map(),
            },
            seen,
            true,
          )
        : null)
    );
  }
  propertyInfo(expression, context, seen = new Set(), globalScope = false) {
    const owner = this.classOf(
      expression.expression,
      context,
      seen,
      globalScope,
    );
    if (!owner || this.ambiguous.has(owner)) return undefined;
    return this.classes
      .get(owner)
      ?.properties.get(
        this.memberKey(
          expression.property.text,
          expression.expression,
          context,
          globalScope,
        ),
      );
  }
  callableOf(expression, context, seen = new Set()) {
    if (seen.has(expression)) return null;
    seen.add(expression);
    if (expression instanceof ParenthesizedExpression)
      return this.callableOf(expression.expression, context, seen);
    if (expression instanceof FunctionExpression) return expression.declaration;
    if (expression instanceof IdentifierExpression) {
      const variable = this.localVariable(
        expression.text,
        expression.range.start,
        context,
      );
      if (variable) {
        return variable.is(8) && variable.initializer
          ? this.callableOf(variable.initializer, context, seen)
          : null;
      }
      if (context.parameters.has(expression.text)) return null;
      const local = this.lexicalFunction(
        expression.text,
        expression.range.start,
      );
      if (local !== undefined) return local;
    }
    const path = this.unshadowedPath(expression, context, false);
    const key = path ? this.runtimeKey(path, expression.range.start) : null;
    if (key && this.globals.has(key)) {
      const variable = this.globals.get(key);
      return variable.is(8) && variable.initializer
        ? this.callableOf(
            variable.initializer,
            {
              ...context,
              declaration: null,
              bindings: new Map(),
              parameters: new Map(),
            },
            seen,
          )
        : null;
    }
    if (key && this.functions.has(key)) return this.functions.get(key);
    if (expression instanceof PropertyAccessExpression) {
      const owner = this.classOf(expression.expression, context, new Set());
      if (owner && !this.ambiguous.has(owner))
        return (
          this.classes
            .get(owner)
            ?.methods.get(
              this.memberKey(
                expression.property.text,
                expression.expression,
                context,
              ),
            ) ?? null
        );
    }
    return undefined;
  }
  classOf(expression, context, seen, globalScope = false) {
    if (seen.has(expression)) return null;
    seen.add(expression);
    if (
      expression instanceof ParenthesizedExpression ||
      (expression instanceof AssertionExpression &&
        expression.assertionKind === 2)
    )
      return this.classOf(expression.expression, context, seen, globalScope);
    if (expression instanceof NewExpression)
      return this.resolve(this.newTypeName(expression), expression.range.start);
    if (expression instanceof CallExpression) {
      const callee = expression.expression;
      if (!globalScope && callee instanceof IdentifierExpression) {
        const initializer = this.localVariable(
          callee.text,
          expression.range.start,
          context,
        )?.initializer;
        if (initializer instanceof FunctionExpression) {
          const result = typeName(initializer.declaration.signature.returnType);
          return result ? this.resolve(result, initializer.range.start) : null;
        }
        const callback =
          this.localVariable(callee.text, expression.range.start, context)
            ?.type ??
          context.declaration?.signature.parameters.find(
            (p) => p.name.text === callee.text,
          )?.type;
        if (callback instanceof FunctionTypeNode) {
          const result = typeName(callback.returnType);
          return result ? this.resolve(result, callback.range.start) : null;
        }
      }
      if (!globalScope && callee instanceof IdentifierExpression) {
        if (
          this.localVariable(callee.text, expression.range.start, context) ||
          context.parameters.has(callee.text)
        )
          return null;
        const local = this.lexicalFunction(callee.text, expression.range.start);
        if (local !== undefined) {
          const result = typeName(local?.signature.returnType ?? null);
          return result ? this.resolve(result, local.range.start) : null;
        }
      }
      const path = this.unshadowedPath(callee, context, globalScope);
      const key = path ? this.runtimeKey(path, expression.range.start) : null;
      let declaration = key ? this.functions.get(key) : null;
      if (!declaration && callee instanceof PropertyAccessExpression) {
        const owner = this.classOf(
          callee.expression,
          context,
          seen,
          globalScope,
        );
        if (owner && !this.ambiguous.has(owner))
          declaration = this.classes
            .get(owner)
            ?.methods.get(
              this.memberKey(
                callee.property.text,
                callee.expression,
                context,
                globalScope,
              ),
            );
      }
      const result = typeName(declaration?.signature.returnType ?? null);
      return result ? this.resolve(result, declaration.range.start) : null;
    }
    if (expression instanceof AssertionExpression) {
      const name = typeName(expression.toType);
      return name ? this.resolve(name, expression.range.start) : null;
    }
    if (expression instanceof IdentifierExpression) {
      const name = expression.text;
      if (name === "this")
        return globalScope
          ? null
          : (context.className ??
              (context.declaration
                ? this.ownerOf(context.declaration)
                : null) ??
              null);
      if (!globalScope) {
        const variable = this.localVariable(
          name,
          expression.range.start,
          context,
        );
        if (variable) {
          const declared = typeName(variable.type);
          if (declared) return this.resolve(declared, variable.range.start);
          return variable.initializer
            ? this.classOf(variable.initializer, context, seen)
            : null;
        }
        const parameter = context.declaration?.signature.parameters.find(
          (p) => p.name.text === name,
        );
        if (parameter || context.parameters.has(name)) {
          const declared = typeName(parameter?.type ?? null);
          return declared
            ? this.resolve(declared, parameter.range.start)
            : null;
        }
      }
      return this.globalOrClass(name, expression.range.start, context, seen);
    }
    if (expression instanceof PropertyAccessExpression) {
      const field = this.propertyInfo(expression, context, seen, globalScope);
      if (field) {
        const declared = typeName(field.type);
        if (declared)
          return this.resolve(declared, field.declaration.range.start);
        if (field.initializer)
          return this.classOf(
            field.initializer,
            {
              ...context,
              declaration: null,
              className: this.ownerOf(field.declaration),
              bindings: new Map(),
              parameters: new Map(),
              duplicateNames: new Set(),
            },
            seen,
          );
        return null;
      }
      const path = this.unshadowedPath(expression, context, globalScope);
      if (path)
        return this.globalOrClass(path, expression.range.start, context, seen);
    }
    return null;
  }
  localVariable(name, position, context) {
    let result;
    let width = Number.MAX_SAFE_INTEGER;
    const parameter = context.declaration?.signature.parameters.some(
      (p) => p.name.text === name,
    );
    const body = context.declaration?.body?.range;
    for (const candidate of this.variables.get(name) ?? []) {
      const scope = candidate.scope.range;
      if (scope.start >= position || scope.end <= position) continue;
      if (
        parameter &&
        body &&
        (scope.start < body.start || scope.end > body.end)
      )
        continue;
      const candidateWidth = scope.end - scope.start;
      if (candidateWidth < width) {
        result = candidate.declaration;
        width = candidateWidth;
      }
    }
    return result;
  }
  lexicalFunction(name, position) {
    let result;
    let width = Number.MAX_SAFE_INTEGER;
    for (const candidate of this.lexicalFunctions) {
      const scope = candidate.scope.range;
      if (
        candidate.declaration.name.text !== name ||
        scope.start >= position ||
        scope.end <= position
      )
        continue;
      const candidateWidth = scope.end - scope.start;
      if (candidateWidth < width) {
        result = candidate.declaration;
        width = candidateWidth;
      } else if (candidateWidth === width && candidate.declaration !== result)
        result = null;
    }
    return result;
  }
  globalOrClass(name, position, context, seen) {
    const key = this.runtimeKey(name, position);
    if (key && this.globals.has(key)) {
      const global = this.globals.get(key);
      const declared = typeName(global.type);
      if (declared) return this.resolve(declared, global.range.start);
      return global.initializer
        ? this.classOf(global.initializer, context, seen, true)
        : null;
    }
    return key && this.classes.has(key) ? key : null;
  }
  unshadowedPath(expression, context, globalScope) {
    const parts = [];
    let root = expression;
    while (root instanceof PropertyAccessExpression) {
      parts.unshift(root.property.text);
      root = root.expression;
    }
    if (
      !(root instanceof IdentifierExpression) ||
      (!globalScope &&
        (this.localVariable(root.text, expression.range.start, context) ||
          context.parameters.has(root.text)))
    )
      return null;
    return [root.text, ...parts].join(".");
  }
  memberKey(name, receiver, context, globalScope = false) {
    while (
      receiver instanceof ParenthesizedExpression ||
      (receiver instanceof AssertionExpression && receiver.assertionKind === 2)
    )
      receiver = receiver.expression;
    if (receiver instanceof IdentifierExpression && receiver.text === "this")
      return context.declaration?.is(32) ? `static:${name}` : name;
    const path = this.unshadowedPath(receiver, context, globalScope);
    const key = path ? this.runtimeKey(path, receiver.range.start) : null;
    return key && this.classes.has(key) ? `static:${name}` : name;
  }
  runtimeKey(name, position) {
    return this.resolveIn(name, position, {
      has: (key) =>
        this.classes.has(key) ||
        this.globals.has(key) ||
        this.functions.has(key),
    });
  }
  newTypeName(expression) {
    const parts = [];
    let name = expression.typeName;
    while (name) {
      parts.push(name.identifier.text);
      name = name.next;
    }
    return parts.join(".");
  }
  namespaceAt(position) {
    let best = "",
      width = Number.MAX_SAFE_INTEGER;
    for (const scope of this.namespaces) {
      if (
        scope.start < position &&
        position < scope.end &&
        scope.end - scope.start < width
      ) {
        best = scope.name;
        width = scope.end - scope.start;
      }
    }
    return best;
  }
  resolve(name, position) {
    return this.resolveIn(name, position, this.classes);
  }
  resolveIn(name, position, symbols) {
    let scope = this.namespaceAt(position);
    while (scope) {
      const qualified = `${scope}.${name}`;
      if (symbols.has(qualified)) return qualified;
      const dot = scope.lastIndexOf(".");
      scope = dot < 0 ? "" : scope.slice(0, dot);
    }
    return symbols.has(name) ? name : null;
  }
}
