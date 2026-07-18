import {
  Function as ASFunction,
  Global,
  Local,
  Property,
} from "assemblyscript/dist/assemblyscript.js";
import { readFileSync, writeFileSync } from "fs";
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
function sourceIsUser(source) {
  return !source.isLibrary && !source.internalPath.startsWith("~lib");
}
export function buildSemanticManifest(program) {
  const facts = [];
  const seen = new Set();
  for (const element of program.instancesByName.values()) {
    if (element instanceof Property || element instanceof Global) {
      if (!element.declaration) continue;
      const range = element.declaration.range;
      const source = range.source;
      if (!sourceIsUser(source)) continue;
      const resolvedType = element.type.toString();
      const representation = representationOfResolvedType(resolvedType);
      if (representation === "unknown") continue;
      const kind = element instanceof Property ? "field" : "global";
      const key = `${source.normalizedPath}:${range.start}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
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
    if (!seen.has(returnKey)) {
      seen.add(returnKey);
      facts.push({
        source: functionSource.normalizedPath,
        start: functionRange.start,
        end: functionRange.end,
        name: element.prototype.declaration.name.text,
        kind: "return",
        representation: returnRepresentation,
        resolvedType: returnType,
      });
    }
    element.prototype.declaration.signature.parameters.forEach(
      (parameter, index) => {
        const resolvedType =
          element.signature.parameterTypes[index]?.toString();
        if (!resolvedType) return;
        const representation = representationOfResolvedType(resolvedType);
        if (representation === "unknown") return;
        const range = parameter.range;
        const key = `${functionSource.normalizedPath}:${range.start}:parameter`;
        if (seen.has(key)) return;
        seen.add(key);
        facts.push({
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
      if (!sourceIsUser(source)) continue;
      const resolvedType = local.type.toString();
      const representation = representationOfResolvedType(resolvedType);
      if (representation === "unknown") continue;
      const key = `${source.normalizedPath}:${range.start}:local`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
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
  facts.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.start - right.start ||
      left.kind.localeCompare(right.kind),
  );
  return { version: 1, facts };
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
