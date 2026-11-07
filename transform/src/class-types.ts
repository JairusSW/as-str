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
  AssertionKind,
  BlockStatement,
  ExpressionStatement,
  ElementAccessExpression,
  ClassDeclaration,
  CallExpression,
  CommonFlags,
  FunctionDeclaration,
  FunctionExpression,
  FunctionTypeNode,
  Expression,
  FieldDeclaration,
  ForStatement,
  ForOfStatement,
  IdentifierExpression,
  NamespaceDeclaration,
  NewExpression,
  Node,
  ParenthesizedExpression,
  PropertyAccessExpression,
  Source,
  StringLiteralExpression,
  SwitchCase,
  TypeNode,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { Representation, representationOfType, viewType } from "./ast.js";
import type { Binding, FunctionContext } from "./model.js";
import { walk } from "./visitor.js";

interface PropertyInfo {
  readonly declaration: FieldDeclaration | FunctionDeclaration;
  readonly type: TypeNode | null;
  readonly initializer: Expression | null;
  readonly representation: Representation;
}

interface ClassInfo {
  declaration: ClassDeclaration;
  properties: Map<string, PropertyInfo>;
  methods: Map<string, FunctionDeclaration | null>;
}

const resolvingDefaultInitializers = new WeakSet<Expression>();

/** Scoped class, property and callable types, including imported declarations. */
export class SourceClassTypes {
  private readonly classes = new Map<string, ClassInfo>();
  private readonly owners = new Map<Node, string>();
  private readonly namespaces: { name: string; start: number; end: number }[] =
    [];
  private readonly ambiguous = new Set<string>();
  private readonly globals = new Map<string, VariableDeclaration>();
  private readonly functions = new Map<string, FunctionDeclaration | null>();
  private readonly variables = new Map<
    string,
    { declaration: VariableDeclaration; scope: Node }[]
  >();
  private readonly lexicalFunctions: {
    declaration: FunctionDeclaration;
    scope: BlockStatement | SwitchCase;
  }[] = [];

  private readonly resolvingClasses = new Set<Expression>();
  private readonly foreignAnalyzers = new WeakMap<Source, SourceClassTypes>();
  private readonly completedClasses = new Set<string>();
  private readonly visitingClasses = new Set<string>();

  constructor(private readonly source: Source) {
    // One pre-order pass: a namespace is always registered before the
    // declarations inside it consult `namespaceAt`.
    walk(source, (node, ref) => {
      if (node instanceof NamespaceDeclaration) {
        const scope = this.namespaceAt(node.range.start);
        this.namespaces.push({
          name: scope ? `${scope}.${node.name.text}` : node.name.text,
          start: node.range.start,
          end: node.range.end,
        });
      } else if (node instanceof VariableDeclaration) {
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
        if (
          ref.grandparent === source ||
          ref.grandparent instanceof NamespaceDeclaration
        ) {
          const namespace = this.namespaceAt(node.range.start);
          this.globals.set(
            namespace ? `${namespace}.${node.name.text}` : node.name.text,
            node,
          );
        }
      } else if (node instanceof FunctionExpression) {
        // Block-local declarations are parsed as expression statements.
        if (
          ref.parent instanceof ExpressionStatement &&
          (ref.grandparent instanceof BlockStatement ||
            ref.grandparent instanceof SwitchCase)
        )
          this.lexicalFunctions.push({
            declaration: node.declaration,
            scope: ref.grandparent,
          });
      } else if (node instanceof FunctionDeclaration) {
        if (
          ref.parent === source ||
          ref.parent instanceof NamespaceDeclaration
        ) {
          const scope = this.namespaceAt(node.range.start);
          const name = scope ? `${scope}.${node.name.text}` : node.name.text;
          this.functions.set(name, this.functions.has(name) ? null : node);
        }
      } else if (node instanceof ClassDeclaration) {
        const scope = this.namespaceAt(node.range.start);
        const owner = scope ? `${scope}.${node.name.text}` : node.name.text;
        if (this.classes.has(owner)) this.ambiguous.add(owner);
        this.registerClass(node, owner);
      }
    });
    for (const owner of this.classes.keys()) this.inheritClass(owner);
  }

  private registerClass(node: ClassDeclaration, owner: string): void {
    const properties = new Map<string, PropertyInfo>();
    const methods = new Map<string, FunctionDeclaration | null>();
    this.owners.set(node, owner);
    for (const member of node.members) {
      this.owners.set(member, owner);
      const key = member.is(CommonFlags.Static)
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
        if (member.isAny(CommonFlags.Get | CommonFlags.Set)) {
          const getter = member.is(CommonFlags.Get);
          methods.set(`${getter ? "get" : "set"}:${key}`, member);
          const type = getter
            ? member.signature.returnType
            : (member.signature.parameters[0]?.type ?? null);
          // Prefer the getter declaration when both accessors are present.
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

  private inheritClass(owner: string): void {
    if (this.completedClasses.has(owner) || this.visitingClasses.has(owner))
      return;
    const info = this.classes.get(owner);
    if (!info) return;
    this.visitingClasses.add(owner);
    const parent = this.classFromType(info.declaration.extendsType);
    if (!this.ambiguous.has(owner) && parent && !this.ambiguous.has(parent)) {
      this.inheritClass(parent);
      for (const [name, property] of this.classes.get(parent)!.properties)
        if (!info.properties.has(name)) info.properties.set(name, property);
      for (const [name, method] of this.classes.get(parent)!.methods)
        if (!info.methods.has(name)) info.methods.set(name, method);
    }
    this.visitingClasses.delete(owner);
    this.completedClasses.add(owner);
  }

  ownerOf(declaration: Node): string | undefined {
    return this.owners.get(declaration);
  }

  declarationOf(
    expression: IdentifierExpression,
    context: FunctionContext,
  ): VariableDeclaration | undefined {
    return this.localVariable(expression.text, expression.range.start, context);
  }

  bindingOf(
    expression: IdentifierExpression,
    context: FunctionContext,
  ): Binding | undefined {
    const binding = context.bindings.get(expression.text);
    return binding?.declaration === this.declarationOf(expression, context)
      ? binding
      : undefined;
  }

  globalDeclarationOf(
    expression: IdentifierExpression,
    context: FunctionContext,
  ): VariableDeclaration | undefined {
    if (
      this.declarationOf(expression, context) ||
      context.parameters.has(expression.text)
    )
      return undefined;
    const key = this.runtimeKey(expression.text, expression.range.start);
    return key ? this.globals.get(key) : undefined;
  }

  /** A concrete class, including `this` and inferred constructor results. */
  classDeclarationOf(
    expression: Expression,
    context: FunctionContext,
  ): ClassDeclaration | null {
    const owner = this.classOf(expression, context, new Set());
    return owner ? (this.classes.get(owner)?.declaration ?? null) : null;
  }

  propertyOf(
    expression: PropertyAccessExpression,
    context: FunctionContext,
  ): Representation {
    return this.propertyInfo(expression, context)?.representation ?? "unknown";
  }

  /** Accessors may execute user code even without an explicit call node. */
  accessorsOf(
    expression: PropertyAccessExpression,
    context: FunctionContext,
  ): FunctionDeclaration[] {
    const owner = this.classOf(expression.expression, context, new Set());
    if (!owner || this.ambiguous.has(owner)) return [];
    const key = this.memberKey(
      expression.property.text,
      expression.expression,
      context,
    );
    const methods = this.classes.get(owner)?.methods;
    return [methods?.get(`get:${key}`), methods?.get(`set:${key}`)].filter(
      (method): method is FunctionDeclaration => !!method,
    );
  }

  typeOf(expression: Expression, context: FunctionContext): TypeNode | null {
    return expandedType(this.declaredType(expression, context, new Set()));
  }

  callType(
    call: CallExpression,
    context: FunctionContext,
    declaration?: FunctionDeclaration | null,
  ): FunctionTypeNode | null {
    return this.resolveCallType(call, context, new Set(), false, declaration);
  }

  private resolveCallType(
    call: CallExpression,
    context: FunctionContext,
    seen: Set<Expression>,
    globalScope: boolean,
    declaration = this.callableOf(call.expression, context),
  ): FunctionTypeNode | null {
    if (declaration) {
      let signature = declaration.signature;
      let defaults: (TypeNode | null)[] | undefined;
      let receiver: TypeNode | null = null;
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
        signature = classMemberType(
          receiver,
          classDeclaration,
          signature,
        ) as FunctionTypeNode;
        defaults = declaration.typeParameters?.map((parameter) =>
          classMemberType(receiver, classDeclaration, parameter.defaultType),
        );
      }
      const actual = declaration.typeParameters?.length
        ? call.args.map((argument) =>
            this.declaredType(argument, context, new Set(seen), globalScope),
          )
        : [];
      const defaultValues: (TypeNode | null | undefined)[] = [];
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

  private defaultInitializerType(
    expression: Expression,
    declaration: FunctionDeclaration,
    context: FunctionContext,
  ): TypeNode | null {
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

  private declaredType(
    expression: Expression,
    context: FunctionContext,
    seen: Set<Expression>,
    globalScope = false,
  ): TypeNode | null {
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
      expression.assertionKind === AssertionKind.NonNull
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

  private propertyInfo(
    expression: PropertyAccessExpression,
    context: FunctionContext,
    seen = new Set<Expression>(),
    globalScope = false,
  ): PropertyInfo | undefined {
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

  /** Null denotes a known shadow; undefined permits imported-name fallback. */
  callableOf(
    expression: Expression,
    context: FunctionContext,
    seen = new Set<Expression>(),
  ): FunctionDeclaration | null | undefined {
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
        return variable.is(CommonFlags.Const) && variable.initializer
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
      const variable = this.globals.get(key)!;
      return variable.is(CommonFlags.Const) && variable.initializer
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

  private classOf(
    expression: Expression,
    context: FunctionContext,
    seen: Set<Expression>,
    globalScope = false,
  ): string | null {
    if (this.resolvingClasses.has(expression)) return null;
    this.resolvingClasses.add(expression);
    try {
      return this.resolveClass(expression, context, seen, globalScope);
    } finally {
      this.resolvingClasses.delete(expression);
    }
  }

  private resolveClass(
    expression: Expression,
    context: FunctionContext,
    seen: Set<Expression>,
    globalScope: boolean,
  ): string | null {
    if (seen.has(expression)) return null;
    seen.add(expression);
    if (
      expression instanceof ParenthesizedExpression ||
      (expression instanceof AssertionExpression &&
        expression.assertionKind === AssertionKind.NonNull)
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

  private localVariable(
    name: string,
    position: number,
    context: FunctionContext,
  ): VariableDeclaration | undefined {
    let result: VariableDeclaration | undefined;
    let width = Number.MAX_SAFE_INTEGER;
    const parameter = context.declaration?.signature.parameters.some(
      (p) => p.name.text === name,
    );
    const body = context.declaration?.body?.range;
    for (const candidate of this.variables.get(name) ?? []) {
      const scope = candidate.scope.range;
      // AssemblyScript resolves case labels in the enclosing scope, before
      // entering the case's local declaration scope.
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

  private lexicalFunction(
    name: string,
    position: number,
  ): FunctionDeclaration | null | undefined {
    let result: FunctionDeclaration | null | undefined;
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

  private globalOrClass(
    name: string,
    position: number,
    context: FunctionContext,
    seen: Set<Expression>,
  ): string | null {
    const key = this.runtimeKey(name, position);
    if (key && this.globals.has(key)) {
      const global = this.globals.get(key)!;
      if (global.type) return this.classFromType(global.type);
      return global.initializer
        ? this.classOf(global.initializer, context, seen, true)
        : null;
    }
    return key && this.classes.has(key) ? key : null;
  }

  private unshadowedPath(
    expression: Expression,
    context: FunctionContext,
    globalScope: boolean,
  ): string | null {
    const parts: string[] = [];
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

  private memberKey(
    name: string,
    receiver: Expression,
    context: FunctionContext,
    globalScope = false,
  ): string {
    while (
      receiver instanceof ParenthesizedExpression ||
      (receiver instanceof AssertionExpression &&
        receiver.assertionKind === AssertionKind.NonNull)
    )
      receiver = receiver.expression;
    if (receiver instanceof IdentifierExpression && receiver.text === "this")
      return context.declaration?.is(CommonFlags.Static)
        ? `static:${name}`
        : name;
    const path = this.unshadowedPath(receiver, context, globalScope);
    const key = path ? this.runtimeKey(path, receiver.range.start) : null;
    const staticClass = key
      ? this.classes.has(key)
      : path && this.classNamed(path, receiver.range);
    return staticClass ? `static:${name}` : name;
  }

  private runtimeKey(name: string, position: number): string | null {
    return this.resolveIn(name, position, {
      has: (key) =>
        this.classes.has(key) ||
        this.globals.has(key) ||
        this.functions.has(key),
    });
  }

  private classFromType(type: TypeNode | null): string | null {
    const declaration = classDeclarationOfType(type);
    if (!declaration) return null;
    const known = this.owners.get(declaration);
    if (known) return known;
    const owner = `@${declaration.range.source.internalPath}:${declaration.range.start}`;
    this.registerClass(declaration, owner);
    this.inheritClass(owner);
    return owner;
  }

  private classNamed(name: string, range: Source["range"]): string | null {
    return this.classFromType(
      Node.createNamedType(
        Node.createSimpleTypeName(name, range),
        null,
        false,
        range,
      ),
    );
  }

  private namespaceAt(position: number): string {
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

  private resolveIn(
    name: string,
    position: number,
    symbols: { has(key: string): boolean },
  ): string | null {
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
