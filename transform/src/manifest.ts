import {
  Function as ASFunction,
  FunctionDeclaration,
  Global,
  Local,
  Program,
  Property,
  Source,
} from "assemblyscript/dist/assemblyscript.js";
import { readFileSync, writeFileSync } from "fs";
import { Representation } from "./ast.js";

export interface SemanticFact {
  source: string;
  start: number;
  end: number;
  name: string;
  kind: "local" | "parameter" | "return" | "field" | "global";
  representation: Representation;
  resolvedType: string;
}

export interface SemanticManifest {
  version: 1;
  facts: SemanticFact[];
}

function representationOfResolvedType(type: string): Representation {
  if (
    type === "string" ||
    /(?:^|\/)string\/String(?:\s*\|\s*null)?$/.test(type)
  ) {
    return "native";
  }
  if (type === "str" || /(?:^|\/)str\/Str(?:\s*\|\s*null)?$/.test(type)) {
    return "view";
  }
  return "unknown";
}

function sourceIsUser(source: Source): boolean {
  return !source.isLibrary && !source.internalPath.startsWith("~lib");
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
        resolvedType: "conflicting generic instantiations",
      });
    }
  }

  for (const element of program.instancesByName.values()) {
    if (element instanceof Property || element instanceof Global) {
      if (!element.declaration) continue;
      const range = element.declaration.range;
      const source = range.source;
      if (!sourceIsUser(source)) continue;
      const resolvedType = element.type.toString();
      const representation = representationOfResolvedType(resolvedType);
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
      });
      continue;
    }
    if (!(element instanceof ASFunction)) continue;
    const functionSource = element.prototype.declaration.range.source;
    if (!sourceIsUser(functionSource)) continue;

    const functionRange = element.prototype.declaration.range;
    const returnType = element.signature.returnType.toString();
    const returnRepresentation = representationOfResolvedType(returnType);
    const returnKey = `${functionSource.normalizedPath}:${functionRange.start}:return`;
    addFact(returnKey, {
      source: functionSource.normalizedPath,
      start: functionRange.start,
      end: functionRange.end,
      name: element.prototype.declaration.name.text,
      kind: "return",
      representation: returnRepresentation,
      resolvedType: returnType,
    });

    (
      element.prototype.declaration as FunctionDeclaration
    ).signature.parameters.forEach((parameter, index) => {
      const resolvedType = element.signature.parameterTypes[index]?.toString();
      if (!resolvedType) return;
      const representation = representationOfResolvedType(resolvedType);
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
      });
    });

    for (const local of element.localsByIndex) {
      if (!(local instanceof Local) || !local.declaration) continue;
      const range = local.declaration.range;
      const source = range.source;
      if (!sourceIsUser(source)) continue;
      const resolvedType = local.type.toString();
      const representation = representationOfResolvedType(resolvedType);
      const key = `${source.normalizedPath}:${range.start}:local`;
      addFact(key, {
        source: source.normalizedPath,
        start: range.start,
        end: range.end,
        name: local.name,
        kind: "local",
        representation,
        resolvedType,
      });
    }
  }

  const facts = [...factsByKey.entries()]
    .filter(
      ([key, fact]) =>
        fact.representation !== "unknown" ||
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
  return { version: 1, facts };
}

export function writeSemanticManifest(
  program: Program,
  filename: string,
): void {
  writeFileSync(
    filename,
    JSON.stringify(buildSemanticManifest(program), null, 2),
  );
}

export function readSemanticManifest(
  filename: string | undefined,
): SemanticManifest | null {
  if (!filename) return null;
  try {
    const parsed = JSON.parse(
      readFileSync(filename, "utf8"),
    ) as SemanticManifest;
    return parsed.version === 1 && Array.isArray(parsed.facts) ? parsed : null;
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
    facts.set(`${fact.kind}:${fact.start}`, fact);
  }
  return facts;
}
