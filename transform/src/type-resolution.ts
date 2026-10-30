import {
  BlockStatement,
  CallExpression,
  ParameterNode,
  ParameterKind,
  StringLiteralExpression,
  ClassDeclaration,
  EnumDeclaration,
  CommonFlags,
  ExportStatement,
  FunctionDeclaration,
  FunctionExpression,
  IdentifierExpression,
  PropertyAccessExpression,
  FunctionTypeNode,
  ImportStatement,
  NamedTypeNode,
  NewExpression,
  NamespaceDeclaration,
  Node,
  Source,
  TypeDeclaration,
  TypeNode,
  TypeParameterNode,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { isPackageSource, sourcesFor } from "./source-identity.js";
import { walk } from "./visitor.js";
import { viewTypeAlias } from "./view-aliases.js";
import type { Representation } from "./ast.js";

type SymbolNode =
  | EnumDeclaration
  | ClassDeclaration
  | TypeDeclaration
  | NamespaceDeclaration
  | TypeParameterNode
  | FunctionDeclaration
  | VariableDeclaration
  | ParameterNode;
interface Scope {
  node: Node;
  parent: Scope | null;
  symbols: Map<string, SymbolNode | null>;
  values: Map<string, SymbolNode | null>;
  namespaces: Map<string, Scope>;
}
interface SourceTypes {
  root: Scope;
  scopes: Scope[];
  bindingNames: Set<string>;
  scopeCache: WeakMap<Source["range"], Scope>;
}
const indexes = new WeakMap<Source, SourceTypes>();

function index(source: Source): SourceTypes {
  const cached = indexes.get(source);
  if (cached) return cached;
  const root: Scope = {
    node: source,
    parent: null,
    symbols: new Map(),
    values: new Map(),
    namespaces: new Map(),
  };
  const scopes = [root];
  const bindingNames = new Set<string>();
  const parents = new Map<Node, Scope>([[source, root]]);
  walk(source, (node, ref) => {
    if (node === source) return;
    if (
      node instanceof VariableDeclaration ||
      node instanceof ParameterNode ||
      node instanceof ClassDeclaration ||
      node instanceof EnumDeclaration ||
      node instanceof NamespaceDeclaration ||
      node instanceof TypeDeclaration ||
      (node instanceof FunctionDeclaration &&
        !(ref.parent instanceof ClassDeclaration))
    )
      bindingNames.add(node.name.text);
    const parent = ref.parent ? (parents.get(ref.parent) ?? root) : root;
    if (
      node instanceof ClassDeclaration ||
      node instanceof EnumDeclaration ||
      node instanceof TypeDeclaration ||
      node instanceof NamespaceDeclaration
    ) {
      const name = node.name.text;
      const previous = parent.symbols.get(name);
      // A type and its static namespace share a name in AssemblyScript.
      if (
        !(
          node instanceof NamespaceDeclaration &&
          (previous instanceof ClassDeclaration ||
            previous instanceof EnumDeclaration ||
            previous instanceof TypeDeclaration ||
            previous instanceof NamespaceDeclaration)
        )
      ) {
        parent.symbols.set(
          name,
          previous instanceof NamespaceDeclaration &&
            !(node instanceof NamespaceDeclaration)
            ? node
            : parent.symbols.has(name)
              ? null
              : node,
        );
      }
    }
    if (
      node instanceof VariableDeclaration ||
      node instanceof ParameterNode ||
      (node instanceof FunctionDeclaration &&
        (ref.parent === source || ref.parent instanceof NamespaceDeclaration))
    ) {
      const name = node.name.text;
      parent.values.set(name, parent.values.has(name) ? null : node);
    }
    if (
      node instanceof BlockStatement ||
      node instanceof ClassDeclaration ||
      node instanceof EnumDeclaration ||
      node instanceof TypeDeclaration ||
      node instanceof NamespaceDeclaration ||
      node instanceof FunctionDeclaration
    ) {
      const merged =
        node instanceof NamespaceDeclaration
          ? parent.namespaces.get(node.name.text)
          : undefined;
      const scope: Scope = {
        node,
        parent,
        symbols: merged?.symbols ?? new Map(),
        values: merged?.values ?? new Map(),
        namespaces: merged?.namespaces ?? new Map(),
      };
      if (node instanceof NamespaceDeclaration && !merged)
        parent.namespaces.set(node.name.text, scope);
      scopes.push(scope);
      parents.set(node, scope);
      if ("typeParameters" in node && node.typeParameters)
        for (const parameter of node.typeParameters)
          scope.symbols.set(parameter.name.text, parameter);
    } else parents.set(node, parent);
  });
  const result = {
    root,
    scopes,
    bindingNames,
    scopeCache: new WeakMap<Source["range"], Scope>(),
  };
  indexes.set(source, result);
  return result;
}

/** Source-wide generated helper names must survive every lexical value scope. */
export function sourceBindsName(source: Source, name: string): boolean {
  return index(source).bindingNames.has(name);
}

function importedSource(
  source: Source,
  internalPath: string | null,
): Source | undefined {
  return sourcesFor(source).find(
    (candidate) => candidate.internalPath === internalPath,
  );
}

function namespaceMember(
  symbol: SymbolNode | null | undefined,
  name: string,
  seen: Set<string>,
  value = false,
): SymbolNode | null {
  if (!(symbol instanceof NamespaceDeclaration)) return null;
  const source = symbol.range.source;
  const scope = index(source).scopes.find((scope) => scope.node === symbol)!;
  return lookup(source, name, { ...scope, parent: null }, seen, value) ?? null;
}

function exported(
  source: Source,
  name: string,
  seen: Set<string>,
  value = false,
): SymbolNode | null {
  const key = `${source.normalizedPath}:${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const [head, ...tail] = name.split(".");
  const root = index(source).root;
  const own =
    value && root.values.has(head)
      ? root.values.get(head)
      : root.symbols.get(head);
  if (own && "is" in own && own.is(CommonFlags.Export))
    return tail.length
      ? namespaceMember(own, tail.join("."), seen, value)
      : own;
  for (const statement of source.statements) {
    if (!(statement instanceof ExportStatement)) continue;
    const target = statement.path
      ? importedSource(source, statement.internalPath)
      : source;
    if (!target) continue;
    if (statement.members) {
      const member = statement.members.find(
        (member) => member.exportedName.text === head,
      );
      if (member)
        return statement.path
          ? exported(
              target,
              [member.localName.text, ...tail].join("."),
              seen,
              value,
            )
          : lookup(
              source,
              [member.localName.text, ...tail].join("."),
              index(source).root,
              seen,
              value,
            );
    } else {
      const found = exported(target, name, seen, value);
      if (found) return found;
    }
  }
  return null;
}

function lookup(
  source: Source,
  name: string,
  scope: Scope,
  seen = new Set<string>(),
  value = false,
): SymbolNode | null | undefined {
  const [head, ...tail] = name.split(".");
  let current: Scope | null = scope;
  while (current) {
    const table =
      value && current.values.has(head) ? current.values : current.symbols;
    if (table.has(head)) {
      const symbol = table.get(head);
      if (!tail.length) return symbol;
      if (!(symbol instanceof NamespaceDeclaration)) return null;
      const nested = index(source).scopes.find(
        (scope) => scope.node === symbol,
      )!;
      return lookup(
        source,
        tail.join("."),
        { ...nested, parent: null },
        seen,
        value,
      );
    }
    current = current.parent;
  }
  for (const statement of source.statements) {
    if (!(statement instanceof ImportStatement)) continue;
    const member = statement.declarations?.find(
      (member) => member.name.text === head,
    );
    if (member || statement.namespaceName?.text === head) {
      const target = importedSource(source, statement.internalPath);
      if (!target) return null;
      if (member) {
        const symbol = exported(target, member.foreignName.text, seen, value);
        return tail.length
          ? namespaceMember(symbol, tail.join("."), seen, value)
          : symbol;
      }
      if (!member && tail.length)
        return exported(target, tail.join("."), seen, value);
      return null;
    }
  }
  return undefined;
}

function scopeAt(source: Source, range: Source["range"]): Scope {
  const info = index(source);
  const cached = info.scopeCache.get(range);
  if (cached) return cached;
  let result = info.root;
  for (let i = info.scopes.length - 1; i >= 0; i--) {
    const scope = info.scopes[i];
    if (
      scope.node.range.start <= range.start &&
      scope.node.range.end >= range.end
    ) {
      result = scope;
      break;
    }
  }
  info.scopeCache.set(range, result);
  return result;
}

export function functionDeclarationOfName(
  name: string,
  range: Source["range"],
  seen = new Set<Node>(),
): FunctionDeclaration | null | undefined {
  const source = range.source;
  const symbol = lookup(source, name, scopeAt(source, range), new Set(), true);
  if (symbol === undefined) return undefined;
  if (symbol instanceof FunctionDeclaration) return symbol;
  if (
    !(symbol instanceof VariableDeclaration) ||
    !symbol.is(CommonFlags.Const) ||
    seen.has(symbol)
  )
    return null;
  seen.add(symbol);
  const initializer = symbol.initializer;
  if (initializer instanceof FunctionExpression) return initializer.declaration;
  let expression = initializer;
  const parts: string[] = [];
  while (expression instanceof PropertyAccessExpression) {
    parts.unshift(expression.property.text);
    expression = expression.expression;
  }
  if (!(expression instanceof IdentifierExpression)) return null;
  return functionDeclarationOfName(
    [expression.text, ...parts].join("."),
    initializer!.range,
    seen,
  );
}

export function declaredValueType(
  name: string,
  range: Source["range"],
): TypeNode | null {
  const source = range.source;
  const symbol = lookup(source, name, scopeAt(source, range), new Set(), true);
  if (symbol instanceof FunctionDeclaration) return symbol.signature;
  if (symbol instanceof ParameterNode) return symbol.type;
  if (!(symbol instanceof VariableDeclaration)) return null;
  if (symbol.type) return symbol.type;
  const initializer = symbol.initializer;
  if (initializer instanceof FunctionExpression)
    return initializer.declaration.signature;
  if (initializer instanceof NewExpression)
    return declaredExpressionType(initializer);
  if (symbol.is(CommonFlags.Const))
    return functionDeclarationOfName(name, range)?.signature ?? null;
  return null;
}

interface ResolvedType {
  type: TypeNode;
  nullable: boolean;
  symbol: SymbolNode | null | undefined;
  substitutions: Map<TypeParameterNode, ResolvedType>;
}

function resolve(
  type: TypeNode,
  substitutions = new Map<TypeParameterNode, ResolvedType>(),
  depth = 0,
): ResolvedType {
  const unknown: ResolvedType = {
    type,
    nullable: type.isNullable,
    symbol: null,
    substitutions,
  };
  if (!(type instanceof NamedTypeNode) || depth > 64) return unknown;
  const names: string[] = [];
  for (let part = type.name; part; part = part.next)
    names.push(part.identifier.text);
  const source = type.range.source;
  const scope = scopeAt(source, type.range);
  const symbol = lookup(source, names.join("."), scope);
  let result: ResolvedType;
  if (symbol instanceof TypeParameterNode) {
    const argument = substitutions.get(symbol);
    if (!argument) return { ...unknown, symbol };
    result = argument;
  } else if (symbol instanceof TypeDeclaration) {
    const bindings = new Map(substitutions);
    for (const [i, parameter] of (symbol.typeParameters ?? []).entries()) {
      const argument = type.typeArguments?.[i] ?? parameter.defaultType;
      if (!argument) return unknown;
      // Resolve caller type parameters before binding the callee's parameters.
      bindings.set(
        parameter,
        resolve(
          argument,
          type.typeArguments?.[i] ? substitutions : bindings,
          depth + 1,
        ),
      );
    }
    result = resolve(symbol.type, bindings, depth + 1);
  } else return { type, nullable: type.isNullable, symbol, substitutions };
  return { ...result, nullable: type.isNullable || result.nullable };
}

/** Expand aliases without mutating shared declarations or losing generic scope. */
export function expandedType(
  type: TypeNode | null,
  substitutions = new Map<TypeParameterNode, ResolvedType>(),
  depth = 0,
): TypeNode | null {
  if (!type || depth > 64) return type;
  const resolved = resolve(type, substitutions);
  const target = resolved.type;
  const expand = (child: TypeNode): TypeNode =>
    expandedType(child, resolved.substitutions, depth + 1)!;
  if (target instanceof NamedTypeNode)
    return Node.createNamedType(
      target.name,
      target.typeArguments?.map(expand) ?? null,
      resolved.nullable,
      target.range,
    );
  if (target instanceof FunctionTypeNode)
    return Node.createFunctionType(
      target.parameters.map((parameter) =>
        Node.createParameter(
          parameter.parameterKind,
          parameter.name,
          expand(parameter.type),
          parameter.initializer,
          parameter.range,
        ),
      ),
      expand(target.returnType),
      target.explicitThisType,
      resolved.nullable,
      target.range,
    );
  return target;
}

export function arrayElementType(type: TypeNode | null): TypeNode | null {
  if (!type) return null;
  const resolved = resolve(type);
  const target = resolved.type;
  if (
    resolved.nullable ||
    !(target instanceof NamedTypeNode) ||
    target.name.next
  )
    return null;
  const name = target.name.identifier.text;
  if (name !== "Array" && name !== "StaticArray") return null;
  if (
    resolved.symbol !== undefined &&
    !(
      resolved.symbol instanceof ClassDeclaration &&
      resolved.symbol.range.source.internalPath ===
        (name === "Array" ? "~lib/array" : "~lib/staticarray")
    )
  )
    return null;
  return expandedType(
    target.typeArguments?.[0] ?? null,
    resolved.substitutions,
  );
}

/** Specialize a member at its receiver, leaving the generic declaration intact. */
export function classMemberType(
  receiver: TypeNode | null,
  owner: ClassDeclaration,
  type: TypeNode | null,
): TypeNode | null {
  if (!receiver || !owner.typeParameters?.length || !type) return type;
  let current = resolve(receiver);
  const seen = new Set<ClassDeclaration>();
  while (
    current.symbol instanceof ClassDeclaration &&
    !seen.has(current.symbol)
  ) {
    const declaration = current.symbol;
    seen.add(declaration);
    const bindings = new Map(current.substitutions);
    for (const [i, parameter] of (declaration.typeParameters ?? []).entries()) {
      const argument =
        current.type instanceof NamedTypeNode
          ? current.type.typeArguments?.[i]
          : null;
      const value = argument ?? parameter.defaultType;
      if (!value) return type;
      bindings.set(
        parameter,
        resolve(value, argument ? current.substitutions : bindings),
      );
    }
    if (declaration === owner) return expandedType(type, bindings);
    if (!declaration.extendsType) break;
    current = resolve(declaration.extendsType, bindings);
  }
  return type;
}

function typeKey(type: TypeNode, seen = new Set<TypeNode>()): string {
  const resolved = resolve(type);
  const rep = stringRepresentation(type, true);
  if (rep !== "unknown") return `${rep}:${resolved.nullable}`;
  const target = resolved.type;
  if (seen.has(target) || seen.size > 32)
    return `recursive:${target.range.source.normalizedPath}:${target.range.start}`;
  const next = new Set(seen).add(target);
  if (target instanceof NamedTypeNode) {
    const name = resolved.symbol
      ? `${resolved.symbol.range.source.normalizedPath}:${resolved.symbol.range.start}`
      : target.name.identifier.text;
    return `${name}:${resolved.nullable}<${(target.typeArguments ?? []).map((child) => typeKey(child, next)).join(",")}>`;
  }
  if (target instanceof FunctionTypeNode)
    return `fn:${resolved.nullable}(${target.parameters.map((p) => typeKey(p.type, next)).join(",")})=>${typeKey(target.returnType, next)}`;
  return `${target.kind}:${resolved.nullable}`;
}

function inferredBindings(
  parameters: readonly TypeParameterNode[],
  explicit: readonly TypeNode[] | null,
  patterns: readonly TypeNode[],
  actual: readonly (TypeNode | null)[],
  defaults?: readonly (TypeNode | null)[],
  defaultArguments?: ReadonlySet<number>,
): Map<TypeParameterNode, ResolvedType> {
  const bindings = new Map<TypeParameterNode, ResolvedType>();
  const fixed = new Set<TypeParameterNode>();
  // Unknown or conflicting argument types must stay unresolved: applying a
  // default here could change the compiler's own inference and object identity.
  const blocked = new Set<TypeParameterNode>();
  for (const [i, parameter] of parameters.entries()) {
    if (explicit?.[i]) {
      bindings.set(parameter, resolve(explicit[i]));
      fixed.add(parameter);
    }
  }
  const infer = (
    pattern: TypeNode,
    value: TypeNode | null,
    depth = 0,
    defaultArgument = false,
  ): void => {
    if (depth > 64) return;
    const resolved = resolve(pattern);
    const symbol = resolved.symbol;
    if (symbol instanceof TypeParameterNode && parameters.includes(symbol)) {
      if (fixed.has(symbol) || blocked.has(symbol)) return;
      if (!value || resolved.nullable) {
        blocked.add(symbol);
        bindings.delete(symbol);
        return;
      }
      const concrete = expandedType(value)!;
      if (defaultArgument && resolve(concrete).symbol === symbol) return;
      const previous = bindings.get(symbol);
      if (previous && typeKey(previous.type) !== typeKey(concrete)) {
        blocked.add(symbol);
        bindings.delete(symbol);
        return;
      }
      bindings.set(symbol, resolve(concrete));
      return;
    }
    const target = resolved.type;
    const concrete = value ? expandedType(value) : null;
    if (target instanceof NamedTypeNode) {
      const other =
        concrete instanceof NamedTypeNode ? resolve(concrete) : null;
      const matching =
        other &&
        (resolved.symbol
          ? resolved.symbol === other.symbol
          : other.symbol === undefined &&
            target.name.identifier.text ===
              (concrete as NamedTypeNode).name.identifier.text);
      for (const [i, argument] of (target.typeArguments ?? []).entries())
        infer(
          expandedType(argument, resolved.substitutions)!,
          matching
            ? ((concrete as NamedTypeNode).typeArguments?.[i] ?? null)
            : null,
          depth + 1,
          defaultArgument,
        );
    } else if (target instanceof FunctionTypeNode) {
      const other = concrete instanceof FunctionTypeNode ? concrete : null;
      for (const [i, parameter] of target.parameters.entries())
        infer(
          parameter.type,
          other?.parameters[i]?.type ?? null,
          depth + 1,
          defaultArgument,
        );
      infer(
        target.returnType,
        other?.returnType ?? null,
        depth + 1,
        defaultArgument,
      );
    }
  };
  for (let i = 0; i < actual.length; i++) {
    if (patterns[i] && actual[i] !== undefined)
      infer(patterns[i], actual[i], 0, defaultArguments?.has(i));
  }
  for (const [i, parameter] of parameters.entries()) {
    const defaultType = defaults?.[i] ?? parameter.defaultType;
    if (!bindings.has(parameter) && !blocked.has(parameter) && defaultType)
      bindings.set(parameter, resolve(defaultType, bindings));
  }
  return bindings;
}

export function functionCallType(
  declaration: FunctionDeclaration,
  arguments_: readonly TypeNode[] | null,
  signature: FunctionTypeNode,
  actual: readonly (TypeNode | null)[],
  defaults?: readonly (TypeNode | null)[],
  defaultValues?: readonly (TypeNode | null | undefined)[],
): FunctionTypeNode {
  if (!declaration.typeParameters?.length) return signature;
  const inputs = [...actual];
  const defaultArguments = new Set<number>();
  for (let i = inputs.length; i < signature.parameters.length; i++) {
    const initializer = signature.parameters[i].initializer;
    if (
      initializer &&
      signature.parameters[i].type.hasGenericComponent(
        declaration.typeParameters,
      )
    ) {
      inputs[i] = defaultValues?.[i] ?? declaredExpressionType(initializer);
      defaultArguments.add(i);
    }
  }
  const bindings = inferredBindings(
    declaration.typeParameters,
    arguments_,
    Array.from(
      { length: Math.max(inputs.length, signature.parameters.length) },
      (_, index) => callArgumentType(signature, index)!,
    ),
    inputs,
    defaults,
    defaultArguments,
  );
  return expandedType(signature, bindings) as FunctionTypeNode;
}

export function callArgumentType(
  signature: FunctionTypeNode | null | undefined,
  index: number,
): TypeNode | null {
  if (!signature) return null;
  const last = signature.parameters.at(-1);
  if (
    last?.parameterKind === ParameterKind.Rest &&
    index >= signature.parameters.length - 1
  )
    return arrayElementType(last.type);
  return signature.parameters[index]?.type ?? null;
}

export function constructedType(
  type: NamedTypeNode,
  actual: readonly (TypeNode | null)[],
): NamedTypeNode {
  const declaration = classDeclarationOfType(type);
  if (
    !declaration?.typeParameters?.length ||
    type.typeArguments?.length === declaration.typeParameters.length
  )
    return type;
  const constructor = declaration.members.find(
    (member) =>
      member instanceof FunctionDeclaration &&
      member.name.text === "constructor",
  ) as FunctionDeclaration | undefined;
  const patterns =
    constructor?.signature.parameters.map((p) => p.type) ??
    declaration.typeParameters.map((parameter) =>
      Node.createNamedType(
        Node.createSimpleTypeName(parameter.name.text, parameter.range),
        null,
        false,
        parameter.range,
      ),
    );
  const inputs = [...actual];
  const defaultArguments = new Set<number>();
  for (
    let i = inputs.length;
    i < (constructor?.signature.parameters.length ?? 0);
    i++
  ) {
    const initializer = constructor!.signature.parameters[i].initializer;
    if (
      initializer &&
      constructor!.signature.parameters[i].type.hasGenericComponent(
        declaration.typeParameters,
      )
    ) {
      inputs[i] = declaredExpressionType(initializer);
      defaultArguments.add(i);
    }
  }
  const bindings = inferredBindings(
    declaration.typeParameters,
    type.typeArguments,
    patterns,
    inputs,
    undefined,
    defaultArguments,
  );
  return Node.createNamedType(
    type.name,
    declaration.typeParameters.map((parameter) => {
      const placeholder = Node.createNamedType(
        Node.createSimpleTypeName(parameter.name.text, parameter.range),
        null,
        false,
        parameter.range,
      );
      return expandedType(placeholder, bindings)!;
    }),
    type.isNullable,
    type.range,
  );
}

const resolvingExpressions = new WeakSet<Node>();

function declaredExpressionType(
  expression: Node,
  seen = new Set<Node>(),
): TypeNode | null {
  if (resolvingExpressions.has(expression)) return null;
  resolvingExpressions.add(expression);
  try {
    return inferExpressionType(expression, seen);
  } finally {
    resolvingExpressions.delete(expression);
  }
}

function inferExpressionType(
  expression: Node,
  seen: Set<Node>,
): TypeNode | null {
  if (seen.has(expression)) return null;
  const next = new Set(seen).add(expression);
  if (expression instanceof StringLiteralExpression)
    return Node.createNamedType(
      Node.createSimpleTypeName("string", expression.range),
      null,
      false,
      expression.range,
    );
  if (expression instanceof FunctionExpression)
    return expression.declaration.signature;
  if (expression instanceof NewExpression)
    return constructedType(
      Node.createNamedType(
        expression.typeName,
        expression.typeArguments,
        false,
        expression.range,
      ),
      expression.args.map((argument) => declaredExpressionType(argument, next)),
    );
  let callee =
    expression instanceof CallExpression ? expression.expression : expression;
  const parts: string[] = [];
  while (callee instanceof PropertyAccessExpression) {
    parts.unshift(callee.property.text);
    callee = callee.expression;
  }
  if (!(callee instanceof IdentifierExpression)) return null;
  const name = [callee.text, ...parts].join(".");
  const source = expression.range.source;
  const symbol = lookup(
    source,
    name,
    scopeAt(source, expression.range),
    new Set(),
    true,
  );
  if (!(expression instanceof CallExpression)) {
    if (symbol instanceof ParameterNode) return symbol.type;
    if (symbol instanceof FunctionDeclaration) return symbol.signature;
    if (symbol instanceof VariableDeclaration)
      return (
        symbol.type ??
        (symbol.initializer
          ? declaredExpressionType(symbol.initializer, next)
          : null)
      );
    return null;
  }
  if (
    callee.text === "str" &&
    (parts.length === 0 ||
      (parts.length === 1 && ["from", "fromRange"].includes(parts[0])))
  ) {
    const base = lookup(
      source,
      "str",
      scopeAt(source, expression.range),
      new Set(),
      true,
    );
    if (base === undefined || (base && isPackageSource(base.range.source)))
      return Node.createNamedType(
        Node.createSimpleTypeName("str", expression.range),
        null,
        false,
        expression.range,
      );
  }
  const declaration = functionDeclarationOfName(name, expression.range);
  if (
    declaration === undefined &&
    name === "changetype" &&
    expression.typeArguments?.[0]
  )
    return expression.typeArguments[0];
  if (declaration)
    return functionCallType(
      declaration,
      expression.typeArguments,
      declaration.signature,
      expression.args.map((argument) => declaredExpressionType(argument, next)),
    ).returnType;
  return null;
}

export function nonNullableType(type: TypeNode | null): TypeNode | null {
  const target = expandedType(type);
  if (!target?.isNullable) return target;
  if (target instanceof NamedTypeNode)
    return Node.createNamedType(
      target.name,
      target.typeArguments,
      false,
      target.range,
    );
  if (target instanceof FunctionTypeNode)
    return Node.createFunctionType(
      target.parameters,
      target.returnType,
      target.explicitThisType,
      false,
      target.range,
    );
  return target;
}

export function typeIsNullable(type: TypeNode | null): boolean {
  return !!type && resolve(type).nullable;
}

export function classDeclarationOfType(
  type: TypeNode | null,
): ClassDeclaration | null {
  const symbol = type ? resolve(type).symbol : null;
  return symbol instanceof ClassDeclaration ? symbol : null;
}

export function stringRepresentation(
  type: TypeNode | null,
  nonNull = false,
): Representation {
  if (!type) return "unknown";
  if (
    type instanceof NamedTypeNode &&
    !type.name.next &&
    type.name.identifier.text === viewTypeAlias(type.range.source)
  )
    return type.isNullable && !nonNull ? "unknown" : "view";
  const resolved = resolve(type);
  if (!nonNull && resolved.nullable) return "unknown";
  if (!(resolved.type instanceof NamedTypeNode)) return "unknown";
  if (resolved.symbol instanceof ClassDeclaration) {
    const source = resolved.symbol.range.source;
    if (
      resolved.symbol.name.text === "Str" &&
      isPackageSource(source) &&
      /(?:^|\/)str$/.test(source.internalPath)
    )
      return "view";
    if (
      resolved.symbol.name.text === "String" &&
      source.internalPath === "~lib/string"
    )
      return "native";
    return "unknown";
  }
  if (resolved.symbol !== undefined) return "unknown";
  const name = resolved.type.name;
  if (name.next) return "unknown";
  // The transform injects these package names after rewriting. Explicit local
  // declarations and imports above take precedence over the implicit names.
  if (name.identifier.text === "str" || name.identifier.text === "Str")
    return "view";
  if (name.identifier.text === "string" || name.identifier.text === "String")
    return "native";
  return "unknown";
}
