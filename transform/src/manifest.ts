import {
  Function as ASFunction,
  FunctionDeclaration,
  Global,
  Local,
  Program,
  Options,
  Property,
  Source,
  Type,
} from "assemblyscript/dist/assemblyscript.js";
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { version as compilerVersion } from "assemblyscript/dist/asc.js";
import { Representation } from "./ast.js";
import { admitSource } from "./source-admission.js";

export interface SemanticFact {
  source: string;
  start: number;
  end: number;
  name: string;
  kind: "local" | "parameter" | "return" | "field" | "global";
  representation: Representation;
  resolvedType: string;
  nullable?: boolean;
}

export interface SemanticScope {
  compiler: string;
  optionsHash: string;
  sources: Record<string, { hash: string; length: number; kind: number }>;
}

export interface SemanticManifest {
  version: 2;
  facts: SemanticFact[];
  complete?: boolean;
  scope?: SemanticScope;
  transformed?: boolean;
}

const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

export function createSemanticScope(
  sources: readonly Source[],
  options: Options,
): SemanticScope {
  const inputs: SemanticScope["sources"] = Object.create(null);
  for (const source of sources)
    inputs[source.normalizedPath] = {
      hash: sha256(source.text),
      length: source.text.length,
      kind: source.sourceKind,
    };
  const settings = Object.entries(options)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, value instanceof Map ? [...value] : value]);
  settings.push([
    "AS_STR_LIBRARY_PREFIXES",
    process.env["AS_STR_LIBRARY_PREFIXES"] ?? "",
  ]);
  return {
    compiler: compilerVersion,
    optionsHash: sha256(JSON.stringify(settings)),
    sources: inputs,
  };
}

function matchingScope(
  actual: SemanticScope,
  expected: SemanticScope,
): boolean {
  const keys = Object.keys(actual.sources);
  return (
    actual.compiler === expected.compiler &&
    actual.optionsHash === expected.optionsHash &&
    keys.length === Object.keys(expected.sources).length &&
    keys.every((key) => {
      const a = actual.sources[key],
        b = expected.sources[key];
      return (
        Object.hasOwn(expected.sources, key) &&
        a.hash === b.hash &&
        a.length === b.length &&
        a.kind === b.kind
      );
    })
  );
}

function validFact(value: unknown): value is SemanticFact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fact = value as Partial<SemanticFact>;
  return (
    typeof fact.source === "string" &&
    fact.source.length > 0 &&
    Number.isSafeInteger(fact.start) &&
    fact.start! >= 0 &&
    Number.isSafeInteger(fact.end) &&
    fact.end! >= fact.start! &&
    typeof fact.name === "string" &&
    typeof fact.resolvedType === "string" &&
    ["local", "parameter", "return", "field", "global"].includes(fact.kind!) &&
    ["native", "view", "unknown"].includes(fact.representation!) &&
    (fact.nullable === undefined || typeof fact.nullable === "boolean")
  );
}

function validScope(value: unknown): value is SemanticScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scope = value as Partial<SemanticScope>;
  const hash = (value: unknown): boolean =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  return (
    typeof scope.compiler === "string" &&
    scope.compiler.length > 0 &&
    hash(scope.optionsHash) &&
    !!scope.sources &&
    typeof scope.sources === "object" &&
    !Array.isArray(scope.sources) &&
    Object.entries(scope.sources).every(
      ([name, entry]) =>
        name.length > 0 &&
        !!entry &&
        typeof entry === "object" &&
        hash(entry.hash) &&
        Number.isSafeInteger(entry.length) &&
        entry.length >= 0 &&
        Number.isSafeInteger(entry.kind) &&
        entry.kind >= 0,
    )
  );
}

function representationOfResolvedType(type: Type): Representation {
  if (!type.isClass || type.isNullableReference) return "unknown";
  const name = type.toString();
  if (name === "string" || /(?:^|\/)string\/String$/.test(name))
    return "native";
  if (name === "str" || /(?:^|\/)str\/Str$/.test(name)) return "view";
  return "unknown";
}

export function buildSemanticManifest(program: Program): SemanticManifest {
  const factsByKey = new Map<string, SemanticFact>();
  const conflicts = new Set<string>();

  function addFact(key: string, fact: SemanticFact): void {
    const previous = factsByKey.get(key);
    if (!previous) {
      factsByKey.set(key, fact);
      return;
    }
    if (conflicts.has(key) || previous.representation !== fact.representation) {
      conflicts.add(key);
      factsByKey.set(key, {
        ...previous,
        representation: "unknown",
        nullable: previous.nullable || fact.nullable,
        resolvedType: "conflicting generic instantiations",
      });
    }
  }

  for (const element of program.instancesByName.values()) {
    if (element instanceof Property || element instanceof Global) {
      if (!element.declaration) continue;
      const range = element.declaration.range;
      const source = range.source;
      if (!admitSource(source).semanticFacts) continue;
      const resolvedType = element.type.toString();
      const representation = representationOfResolvedType(element.type);
      const kind = element instanceof Property ? "field" : "global";
      const key = `${source.normalizedPath}:${range.start}:${kind}`;
      addFact(key, {
        source: source.normalizedPath,
        start: range.start,
        end: range.end,
        name: element.name,
        kind,
        representation,
        resolvedType,
        nullable: element.type.isNullableReference,
      });
      continue;
    }
    if (!(element instanceof ASFunction)) continue;
    const functionSource = element.prototype.declaration.range.source;
    if (!admitSource(functionSource).semanticFacts) continue;

    const functionRange = element.prototype.declaration.range;
    const returnType = element.signature.returnType.toString();
    const returnRepresentation = representationOfResolvedType(
      element.signature.returnType,
    );
    const returnKey = `${functionSource.normalizedPath}:${functionRange.start}:return`;
    addFact(returnKey, {
      source: functionSource.normalizedPath,
      start: functionRange.start,
      end: functionRange.end,
      name: element.prototype.declaration.name.text,
      kind: "return",
      representation: returnRepresentation,
      resolvedType: returnType,
      nullable: element.signature.returnType.isNullableReference,
    });

    (
      element.prototype.declaration as FunctionDeclaration
    ).signature.parameters.forEach((parameter, index) => {
      const resolvedType = element.signature.parameterTypes[index]?.toString();
      if (!resolvedType) return;
      const representation = representationOfResolvedType(
        element.signature.parameterTypes[index],
      );
      const range = parameter.range;
      const key = `${functionSource.normalizedPath}:${range.start}:parameter`;
      addFact(key, {
        source: functionSource.normalizedPath,
        start: range.start,
        end: range.end,
        name: parameter.name.text,
        kind: "parameter",
        representation,
        resolvedType,
        nullable: element.signature.parameterTypes[index].isNullableReference,
      });
    });

    for (const local of element.localsByIndex) {
      if (!(local instanceof Local) || !local.declaration) continue;
      const range = local.declaration.range;
      const source = range.source;
      if (!admitSource(source).semanticFacts) continue;
      const resolvedType = local.type.toString();
      const representation = representationOfResolvedType(local.type);
      const key = `${source.normalizedPath}:${range.start}:local`;
      addFact(key, {
        source: source.normalizedPath,
        start: range.start,
        end: range.end,
        name: local.name,
        kind: "local",
        representation,
        resolvedType,
        nullable: local.type.isNullableReference,
      });
    }
  }

  const facts = [...factsByKey.entries()]
    .filter(
      ([key, fact]) =>
        fact.representation !== "unknown" ||
        fact.nullable ||
        fact.kind === "return" ||
        conflicts.has(key),
    )
    .map(([, fact]) => fact);
  facts.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.start - right.start ||
      left.kind.localeCompare(right.kind),
  );
  return { version: 2, facts, complete: true };
}

export function writeSemanticManifest(
  program: Program,
  filename: string,
  scope = createSemanticScope(program.sources, program.options),
  transformed = false,
): void {
  writeFileSync(
    filename,
    JSON.stringify(
      { ...buildSemanticManifest(program), scope, transformed },
      null,
      2,
    ),
  );
}

export function readSemanticManifest(
  filename: string | undefined,
  expectedScope: SemanticScope,
): SemanticManifest | null {
  if (!filename) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(filename, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const parsed = value as Partial<SemanticManifest>;
    if (
      parsed.version !== 2 ||
      !Array.isArray(parsed.facts) ||
      !parsed.facts.every(validFact) ||
      (parsed.complete !== undefined && typeof parsed.complete !== "boolean") ||
      (parsed.transformed !== undefined &&
        typeof parsed.transformed !== "boolean") ||
      parsed.transformed ||
      !validScope(parsed.scope) ||
      !expectedScope ||
      !matchingScope(parsed.scope, expectedScope)
    )
      return null;
    const keys = new Set<string>();
    for (const fact of parsed.facts) {
      const source = expectedScope.sources[fact.source];
      const key = JSON.stringify([fact.source, fact.kind, fact.start]);
      if (
        !Object.hasOwn(expectedScope.sources, fact.source) ||
        fact.end > source.length ||
        keys.has(key)
      )
        return null;
      keys.add(key);
    }
    return parsed as SemanticManifest;
  } catch {
    return null;
  }
}

export function factsForSource(
  manifest: SemanticManifest | null,
  source: Source,
): Map<string, SemanticFact> {
  const facts = new Map<string, SemanticFact>();
  if (!manifest) return facts;
  for (const fact of manifest.facts) {
    if (fact.source !== source.normalizedPath) continue;
    // Older manifests encoded nullable strings as non-null representations.
    const nullable =
      fact.nullable === true ||
      (!fact.resolvedType.includes("=>") &&
        /\|\s*null\s*$/.test(fact.resolvedType));
    facts.set(
      `${fact.kind}:${fact.start}`,
      nullable || fact.resolvedType.includes("=>")
        ? { ...fact, nullable, representation: "unknown" }
        : fact,
    );
  }
  return facts;
}
