import {
  Function as ASFunction,
  Global,
  Local,
  Property,
} from "assemblyscript/dist/assemblyscript.js";
import { readFileSync, writeFileSync } from "fs";
import { admitSource } from "./source-admission.js";
function representationOfResolvedType(type) {
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
export function buildSemanticManifest(program) {
  const factsByKey = new Map();
  const conflicts = new Set();
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
    if (!admitSource(functionSource).semanticFacts) continue;
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
    element.prototype.declaration.signature.parameters.forEach(
      (parameter, index) => {
        const resolvedType =
          element.signature.parameterTypes[index]?.toString();
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
      },
    );
    for (const local of element.localsByIndex) {
      if (!(local instanceof Local) || !local.declaration) continue;
      const range = local.declaration.range;
      const source = range.source;
      if (!admitSource(source).semanticFacts) continue;
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
  return { version: 1, facts, complete: true };
}
export function writeSemanticManifest(program, filename) {
  writeFileSync(
    filename,
    JSON.stringify(buildSemanticManifest(program), null, 2),
  );
}
export function readSemanticManifest(filename) {
  if (!filename) return null;
  try {
    const parsed = JSON.parse(readFileSync(filename, "utf8"));
    return parsed.version === 1 && Array.isArray(parsed.facts) ? parsed : null;
  } catch {
    return null;
  }
}
export function factsForSource(manifest, source) {
  const facts = new Map();
  if (!manifest) return facts;
  for (const fact of manifest.facts) {
    if (fact.source !== source.normalizedPath) continue;
    facts.set(`${fact.kind}:${fact.start}`, fact);
  }
  return facts;
}
