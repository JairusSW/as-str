import {
  arrayElementType,
  classDeclarationOfType,
  classMemberType,
  constructedType,
  declaredValueType,
  expandedType,
  functionDeclarationOfName,
  functionCallType,
  nonNullableType,
} from "./type-resolution.js";
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
  NewExpression,
  Node,
  ParenthesizedExpression,
  PropertyAccessExpression,
  StringLiteralExpression,
  SwitchCase,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { representationOfType, viewType } from "./ast.js";
import { walk } from "./visitor.js";
const resolvingDefaultInitializers = new WeakSet();
export class SourceClassTypes {
  source;
  classes = new Map();
  owners = new Map();
  namespaces = [];
  ambiguous = new Set();
  globals = new Map();
  functions = new Map();
  variables = new Map();
  lexicalFunctions = [];
  resolvingClasses = new Set();
  foreignAnalyzers = new WeakMap();
  completedClasses = new Set();
  visitingClasses = new Set();
  constructor(source) {
    this.source = source;
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
          scope instanceof ForOfStatement ||
          scope instanceof SwitchCase
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
        (ref.grandparent instanceof BlockStatement ||
          ref.grandparent instanceof SwitchCase)
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
      this.registerClass(node, owner);
    });
    for (const owner of this.classes.keys()) this.inheritClass(owner);
  }
  registerClass(node, owner) {
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
          methods.set(`${getter ? "get" : "set"}:${key}`, member);
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
  }
  inheritClass(owner) {
    if (this.completedClasses.has(owner) || this.visitingClasses.has(owner))
      return;
    const info = this.classes.get(owner);
    if (!info) return;
    this.visitingClasses.add(owner);
    const parent = this.classFromType(info.declaration.extendsType);
    if (!this.ambiguous.has(owner) && parent && !this.ambiguous.has(parent)) {
      this.inheritClass(parent);
      for (const [name, property] of this.classes.get(parent).properties)
        if (!info.properties.has(name)) info.properties.set(name, property);
      for (const [name, method] of this.classes.get(parent).methods)
        if (!info.methods.has(name)) info.methods.set(name, method);
    }
    this.visitingClasses.delete(owner);
    this.completedClasses.add(owner);
  }
  ownerOf(declaration) {
    return this.owners.get(declaration);
  }
  declarationOf(expression, context) {
    return this.localVariable(expression.text, expression.range.start, context);
  }
  bindingOf(expression, context) {
    const binding = context.bindings.get(expression.text);
    return binding?.declaration === this.declarationOf(expression, context)
      ? binding
      : undefined;
  }
  globalDeclarationOf(expression, context) {
    if (
      this.declarationOf(expression, context) ||
      context.parameters.has(expression.text)
    )
      return undefined;
    const key = this.runtimeKey(expression.text, expression.range.start);
    return key ? this.globals.get(key) : undefined;
  }
  propertyOf(expression, context) {
    return this.propertyInfo(expression, context)?.representation ?? "unknown";
  }
  accessorsOf(expression, context) {
    const owner = this.classOf(expression.expression, context, new Set());
    if (!owner || this.ambiguous.has(owner)) return [];
    const key = this.memberKey(
      expression.property.text,
      expression.expression,
      context,
    );
    const methods = this.classes.get(owner)?.methods;
    return [methods?.get(`get:${key}`), methods?.get(`set:${key}`)].filter(
      (method) => !!method,
    );
  }
  typeOf(expression, context) {
    return expandedType(this.declaredType(expression, context, new Set()));
  }
  callType(call, context, declaration) {
    return this.resolveCallType(call, context, new Set(), false, declaration);
  }
  resolveCallType(
    call,
    context,
    seen,
    globalScope,
    declaration = this.callableOf(call.expression, context),
  ) {
    if (declaration) {
      let signature = declaration.signature;
      let defaults;
      let receiver = null;
      const owner = this.ownerOf(declaration);
      const classDeclaration = owner
        ? this.classes.get(owner)?.declaration
        : null;
      if (
        classDeclaration?.typeParameters?.length &&
        call.expression instanceof PropertyAccessExpression
      ) {
        receiver = this.declaredType(
          call.expression.expression,
          context,
          seen,
          globalScope,
        );
        signature = classMemberType(receiver, classDeclaration, signature);
        defaults = declaration.typeParameters?.map((parameter) =>
          classMemberType(receiver, classDeclaration, parameter.defaultType),
        );
      }
      const actual = declaration.typeParameters?.length
        ? call.args.map((argument) =>
            this.declaredType(argument, context, new Set(seen), globalScope),
          )
        : [];
      const defaultValues = [];
      if (declaration.typeParameters?.length) {
        for (let i = call.args.length; i < signature.parameters.length; i++) {
          const initializer = signature.parameters[i].initializer;
          if (
            initializer &&
            signature.parameters[i].type.hasGenericComponent(
              declaration.typeParameters,
            )
          ) {
            const type = this.defaultInitializerType(
              initializer,
              declaration,
              context,
            );
            defaultValues[i] = classDeclaration
              ? classMemberType(receiver, classDeclaration, type)
              : type;
          }
        }
      }
      return functionCallType(
        declaration,
        call.typeArguments,
        signature,
        actual,
        defaults,
        defaultValues,
      );
    }
    const callee = call.expression;
    if (
      declaration === undefined &&
      callee instanceof IdentifierExpression &&
      callee.text === "changetype" &&
      call.typeArguments?.[0]
    )
      return Node.createFunctionType(
        [],
        call.typeArguments[0],
        null,
        false,
        call.range,
      );
    const implicitView =
      (callee instanceof IdentifierExpression && callee.text === "str") ||
      (callee instanceof PropertyAccessExpression &&
        callee.expression instanceof IdentifierExpression &&
        callee.expression.text === "str" &&
        ["from", "fromRange"].includes(callee.property.text));
    if (implicitView && representationOfType(viewType(call.range)) === "view")
      return Node.createFunctionType(
        [],
        viewType(call.range),
        null,
        false,
        call.range,
      );
    const callback = expandedType(
      this.declaredType(call.expression, context, seen, globalScope),
    );
    return callback instanceof FunctionTypeNode ? callback : null;
  }
  defaultInitializerType(expression, declaration, context) {
    if (resolvingDefaultInitializers.has(expression)) return null;
    resolvingDefaultInitializers.add(expression);
    try {
      const source = declaration.range.source;
      const analyzer =
        source === this.source
          ? this
          : (this.foreignAnalyzers.get(source) ?? new SourceClassTypes(source));
      if (source !== this.source) {
        this.foreignAnalyzers.set(source, analyzer);
      }
      return analyzer.typeOf(expression, {
        ...context,
        declaration,
        className: analyzer.ownerOf(declaration),
        bindings: new Map(),
        globals: new Map(),
        duplicateNames: new Set(),
        parameters: new Map(
          declaration.signature.parameters.map((parameter) => [
            parameter.name.text,
            representationOfType(parameter.type),
          ]),
        ),
      });
    } finally {
      resolvingDefaultInitializers.delete(expression);
    }
  }
  declaredType(expression, context, seen, globalScope = false) {
    if (seen.has(expression)) return null;
    seen.add(expression);
    if (expression instanceof ParenthesizedExpression)
      return this.declaredType(
        expression.expression,
        context,
        seen,
        globalScope,
      );
    if (
      expression instanceof AssertionExpression &&
      expression.assertionKind === 2
    )
      return nonNullableType(
        this.declaredType(expression.expression, context, seen, globalScope),
      );
    if (expression instanceof AssertionExpression) return expression.toType;
    if (expression instanceof StringLiteralExpression)
      return Node.createNamedType(
        Node.createSimpleTypeName("string", expression.range),
        null,
        false,
        expression.range,
      );
    if (expression instanceof NewExpression) {
      const type = Node.createNamedType(
        expression.typeName,
        expression.typeArguments,
        false,
        expression.range,
      );
      const declaration = classDeclarationOfType(type);
      return declaration?.typeParameters?.length &&
        expression.typeArguments?.length !== declaration.typeParameters.length
        ? constructedType(
            type,
            expression.args.map((argument) =>
              this.declaredType(argument, context, new Set(seen), globalScope),
            ),
          )
        : type;
    }
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
      return arrayElementType(array);
    }
    if (expression instanceof CallExpression) {
      return (
        this.resolveCallType(expression, context, seen, globalScope)
          ?.returnType ?? null
      );
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
        : path
          ? declaredValueType(path, expression.range)
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
    const property = this.classes
      .get(owner)
      ?.properties.get(
        this.memberKey(
          expression.property.text,
          expression.expression,
          context,
          globalScope,
        ),
      );
    if (!property) return undefined;
    const declaringOwner = this.ownerOf(property.declaration);
    const declaration = declaringOwner
      ? this.classes.get(declaringOwner)?.declaration
      : null;
    if (!declaration?.typeParameters?.length) return property;
    const receiver = this.declaredType(
      expression.expression,
      context,
      new Set(),
      globalScope,
    );
    const type = classMemberType(receiver, declaration, property.type);
    return { ...property, type, representation: representationOfType(type) };
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
    return path ? functionDeclarationOfName(path, expression.range) : undefined;
  }
  classOf(expression, context, seen, globalScope = false) {
    if (this.resolvingClasses.has(expression)) return null;
    this.resolvingClasses.add(expression);
    try {
      return this.resolveClass(expression, context, seen, globalScope);
    } finally {
      this.resolvingClasses.delete(expression);
    }
  }
  resolveClass(expression, context, seen, globalScope) {
    if (seen.has(expression)) return null;
    seen.add(expression);
    if (
      expression instanceof ParenthesizedExpression ||
      (expression instanceof AssertionExpression &&
        expression.assertionKind === 2)
    )
      return this.classOf(expression.expression, context, seen, globalScope);
    if (expression instanceof NewExpression)
      return this.classFromType(
        Node.createNamedType(
          expression.typeName,
          expression.typeArguments,
          false,
          expression.range,
        ),
      );
    if (expression instanceof ElementAccessExpression)
      return this.classFromType(
        this.declaredType(expression, context, new Set(), globalScope),
      );
    if (expression instanceof CallExpression)
      return this.classFromType(
        this.declaredType(expression, context, new Set(), globalScope),
      );
    if (expression instanceof AssertionExpression) {
      return this.classFromType(expression.toType);
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
          if (variable.type) return this.classFromType(variable.type);
          return variable.initializer
            ? this.classOf(variable.initializer, context, seen)
            : null;
        }
        const parameter = context.declaration?.signature.parameters.find(
          (p) => p.name.text === name,
        );
        if (parameter || context.parameters.has(name)) {
          return this.classFromType(parameter?.type ?? null);
        }
      }
      return (
        this.globalOrClass(name, expression.range.start, context, seen) ??
        this.classFromType(declaredValueType(name, expression.range)) ??
        this.classNamed(name, expression.range)
      );
    }
    if (expression instanceof PropertyAccessExpression) {
      const field = this.propertyInfo(expression, context, seen, globalScope);
      if (field) {
        if (field.type) return this.classFromType(field.type);
        if (
          field.initializer &&
          (field.declaration.range.source === this.source ||
            field.initializer instanceof NewExpression)
        )
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
        return (
          this.globalOrClass(path, expression.range.start, context, seen) ??
          this.classFromType(declaredValueType(path, expression.range)) ??
          this.classNamed(path, expression.range)
        );
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
      if (
        candidate.scope instanceof SwitchCase &&
        position < (candidate.scope.statements[0]?.range.start ?? scope.end)
      )
        continue;
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
        candidate.scope instanceof SwitchCase &&
        position < (candidate.scope.statements[0]?.range.start ?? scope.end)
      )
        continue;
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
      if (global.type) return this.classFromType(global.type);
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
    const staticClass = key
      ? this.classes.has(key)
      : path && this.classNamed(path, receiver.range);
    return staticClass ? `static:${name}` : name;
  }
  runtimeKey(name, position) {
    return this.resolveIn(name, position, {
      has: (key) =>
        this.classes.has(key) ||
        this.globals.has(key) ||
        this.functions.has(key),
    });
  }
  classFromType(type) {
    const declaration = classDeclarationOfType(type);
    if (!declaration) return null;
    const known = this.owners.get(declaration);
    if (known) return known;
    const owner = `@${declaration.range.source.internalPath}:${declaration.range.start}`;
    this.registerClass(declaration, owner);
    this.inheritClass(owner);
    return owner;
  }
  classNamed(name, range) {
    return this.classFromType(
      Node.createNamedType(
        Node.createSimpleTypeName(name, range),
        null,
        false,
        range,
      ),
    );
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
