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
  NamedTypeNode,
  NewExpression,
  Node,
  ParenthesizedExpression,
  PropertyAccessExpression,
  Source,
  TypeNode,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { Representation, representationOfType, typeName } from "./ast.js";
import type { FunctionContext } from "./model.js";
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

/** Source-local class, property and callable types, without leaf-name guesses. */
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
    scope: BlockStatement;
  }[] = [];

  constructor(source: Source) {
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
      // Block-local declarations are parsed as expression statements.
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
    });
    const done = new Set<string>(),
      visiting = new Set<string>();
    const inherit = (owner: string): void => {
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
        for (const [name, property] of this.classes.get(parent)!.properties) {
          if (!info.properties.has(name)) info.properties.set(name, property);
        }
        for (const [name, method] of this.classes.get(parent)!.methods) {
          if (!info.methods.has(name)) info.methods.set(name, method);
        }
      }
      visiting.delete(owner);
      done.add(owner);
    };
    for (const owner of this.classes.keys()) inherit(owner);
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

  propertyOf(
    expression: PropertyAccessExpression,
    context: FunctionContext,
  ): Representation {
    return this.propertyInfo(expression, context)?.representation ?? "unknown";
  }

  typeOf(expression: Expression, context: FunctionContext): TypeNode | null {
    return this.declaredType(expression, context, new Set());
  }

  private declaredType(
    expression: Expression,
    context: FunctionContext,
    seen: Set<Expression>,
    globalScope = false,
  ): TypeNode | null {
    if (seen.has(expression)) return null;
    seen.add(expression);
    if (
      expression instanceof ParenthesizedExpression ||
      (expression instanceof AssertionExpression &&
        expression.assertionKind === AssertionKind.NonNull)
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
    return undefined;
  }

  private classOf(
    expression: Expression,
    context: FunctionContext,
    seen: Set<Expression>,
    globalScope = false,
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
          return result ? this.resolve(result, local!.range.start) : null;
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
      return result ? this.resolve(result, declaration!.range.start) : null;
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
            ? this.resolve(declared, parameter!.range.start)
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
      const declared = typeName(global.type);
      if (declared) return this.resolve(declared, global.range.start);
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
    return key && this.classes.has(key) ? `static:${name}` : name;
  }

  private runtimeKey(name: string, position: number): string | null {
    return this.resolveIn(name, position, {
      has: (key) =>
        this.classes.has(key) ||
        this.globals.has(key) ||
        this.functions.has(key),
    });
  }

  private newTypeName(expression: NewExpression): string {
    const parts: string[] = [];
    let name: typeof expression.typeName | null = expression.typeName;
    while (name) {
      parts.push(name.identifier.text);
      name = name.next;
    }
    return parts.join(".");
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

  private resolve(name: string, position: number): string | null {
    return this.resolveIn(name, position, this.classes);
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
