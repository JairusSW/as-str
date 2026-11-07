import {
  Function as ASFunction,
  FunctionDeclaration,
  Global,
  Local,
  Property,
  VariableDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { URL } from "url";
import { version as compilerVersion } from "assemblyscript/dist/asc.js";
import { generatedTypes } from "./ast.js";
import { walk } from "./visitor.js";
import { admitSource } from "./source-admission.js";
import { isPackageSource } from "./source-identity.js";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const transformDirectory = new URL(".", import.meta.url);
const transformDigest = createHash("sha256");
for (const name of readdirSync(transformDirectory)
  .filter((name) => name.endsWith(".js"))
  .sort()) {
  transformDigest.update(name).update("\0");
  transformDigest
    .update(readFileSync(new URL(name, transformDirectory)))
    .update("\0");
}
const transformHash = transformDigest.digest("hex");
export function createSemanticScope(sources, options) {
  const inputs = Object.create(null);
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
    transformHash,
    optionsHash: sha256(JSON.stringify(settings)),
    sources: inputs,
  };
}
function matchingScope(actual, expected) {
  const keys = Object.keys(actual.sources);
  return (
    actual.compiler === expected.compiler &&
    actual.transformHash === expected.transformHash &&
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
function validFact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fact = value;
  return (
    typeof fact.source === "string" &&
    fact.source.length > 0 &&
    Number.isSafeInteger(fact.start) &&
    fact.start >= 0 &&
    Number.isSafeInteger(fact.end) &&
    fact.end >= fact.start &&
    typeof fact.name === "string" &&
    typeof fact.resolvedType === "string" &&
    ["local", "parameter", "return", "field", "global"].includes(fact.kind) &&
    ["native", "view", "unknown"].includes(fact.representation) &&
    (fact.nullable === undefined || typeof fact.nullable === "boolean")
  );
}
function validScope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scope = value;
  const hash = (value) =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  return (
    typeof scope.compiler === "string" &&
    scope.compiler.length > 0 &&
    hash(scope.transformHash) &&
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
function representationOfResolvedType(type) {
  if (!type.isClass || type.isNullableReference) return "unknown";
  const declaration = type.classReference?.prototype.declaration;
  if (!declaration) return "unknown";
  const source = declaration.range.source;
  if (
    declaration.name.text === "String" &&
    source.internalPath === "~lib/string"
  )
    return "native";
  if (
    declaration.name.text === "Str" &&
    isPackageSource(source) &&
    /(?:^|\/)str$/.test(source.internalPath)
  )
    return "view";
  return "unknown";
}
function localDeclarations(element) {
  const declarations = new Map();
  const declaration = element.prototype.declaration;
  walk(declaration.body, (node) => {
    if (node instanceof FunctionDeclaration) return false;
    if (!(node instanceof VariableDeclaration)) return;
    const list = declarations.get(node.name.text) ?? [];
    list.push(node);
    declarations.set(node.name.text, list);
  });
  return declarations;
}
export function buildSemanticManifest(program) {
  const factsByKey = new Map();
  const conflicts = new Set();
  const admitted = new WeakMap();
  function includes(source) {
    const known = admitted.get(source);
    if (known !== undefined) return known;
    const selected = admitSource(source).semanticFacts;
    admitted.set(source, selected);
    return selected;
  }
  function addFact(key, fact) {
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
      if (!includes(source)) continue;
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
    if (!includes(functionSource)) continue;
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
    element.prototype.declaration.signature.parameters.forEach(
      (parameter, index) => {
        const resolvedType =
          element.signature.parameterTypes[index]?.toString();
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
      },
    );
    const declarations = localDeclarations(element);
    const localCounts = new Map();
    for (const local of element.localsByIndex)
      if (local instanceof Local)
        localCounts.set(local.name, (localCounts.get(local.name) ?? 0) + 1);
    for (const local of element.localsByIndex) {
      if (!(local instanceof Local)) continue;
      const candidates = declarations.get(local.name);
      const declaration =
        candidates?.length === 1 && localCounts.get(local.name) === 1
          ? candidates[0]
          : null;
      if (
        !declaration ||
        local.name.startsWith("__as_str_") ||
        (declaration.type && generatedTypes.has(declaration.type))
      )
        continue;
      const range = declaration.range;
      const source = range.source;
      if (!includes(source)) continue;
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
  program,
  filename,
  scope = createSemanticScope(program.sources, program.options),
  transformed = false,
) {
  writeFileSync(
    filename,
    JSON.stringify(
      { ...buildSemanticManifest(program), scope, transformed },
      null,
      2,
    ),
  );
}
export function readSemanticManifest(filename, expectedScope) {
  if (!filename) return null;
  try {
    const value = JSON.parse(readFileSync(filename, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const parsed = value;
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
    const keys = new Set();
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
    return parsed;
  } catch {
    return null;
  }
}
export function factsForSource(manifest, source) {
  const facts = new Map();
  if (!manifest) return facts;
  for (const fact of manifest.facts) {
    if (fact.source !== source.normalizedPath) continue;
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
