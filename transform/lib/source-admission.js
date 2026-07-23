import { ImportStatement } from "assemblyscript/dist/assemblyscript.js";
export const PACKAGE_NAME = "as-str";
export const VIEW_NAME = "str";
export const VIEW_CLASS_NAME = "Str";
const VIEW_USES =
  /(?:\bstr\s*[.(]|:\s*str\b|\bnew\s+str\b|<\s*str\s*>|\bstr\s*\[\s*\])/;
const VIEW_BINDS =
  /(?:\b(?:const|let|var|function|class|namespace|type)\s+str\b|\(\s*str\s*:|,\s*str\s*:)/;
const VIEW_CLASS_USES =
  /(?:\bStr\s*\.|:\s*Str\b|\bnew\s+Str\b|<\s*Str\s*>|\bStr\s*\[\s*\])/;
const VIEW_CLASS_BINDS =
  /(?:\b(?:const|let|var|function|class|namespace|type)\s+Str\b|\(\s*Str\s*:|,\s*Str\s*:)/;
const OWN_SOURCES = new Set([
  "assembly/index.ts",
  "assembly/str.ts",
  "assembly/str8.ts",
  "assembly/util.ts",
  "assembly/util8.ts",
  "index.ts",
]);
function libraryPrefixes() {
  return (process.env["AS_STR_LIBRARY_PREFIXES"] ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);
}
function sourceIsConfigured(source) {
  return (
    (!source.isLibrary && !source.internalPath.startsWith("~lib")) ||
    libraryPrefixes().some((prefix) => source.internalPath.startsWith(prefix))
  );
}
function isPackageSource(source) {
  if (OWN_SOURCES.has(source.normalizedPath)) return true;
  const internalPath = source.internalPath.replace(/\.ts$/, "");
  if (internalPath === `~lib/${PACKAGE_NAME}/index`) return true;
  const libraryPrefix = `~lib/${PACKAGE_NAME}/`;
  return (
    internalPath.startsWith(libraryPrefix) &&
    OWN_SOURCES.has(internalPath.slice(libraryPrefix.length) + ".ts")
  );
}
function importedNames(source) {
  const names = new Set();
  for (const stmt of source.statements) {
    if (!(stmt instanceof ImportStatement)) continue;
    if (stmt.namespaceName) names.add(stmt.namespaceName.text);
    if (stmt.declarations) {
      for (const declaration of stmt.declarations) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}
export function admitSource(source, forcedImport = false) {
  const semanticFacts = sourceIsConfigured(source);
  const packageSource = isPackageSource(source);
  const already = importedNames(source);
  const viewNameAvailable =
    already.has(VIEW_NAME) || !VIEW_BINDS.test(source.text);
  const requestedViewNames = [];
  if (
    !already.has(VIEW_NAME) &&
    viewNameAvailable &&
    (forcedImport || VIEW_USES.test(source.text))
  ) {
    requestedViewNames.push(VIEW_NAME);
  }
  if (
    !already.has(VIEW_CLASS_NAME) &&
    !VIEW_CLASS_BINDS.test(source.text) &&
    VIEW_CLASS_USES.test(source.text)
  ) {
    requestedViewNames.push(VIEW_CLASS_NAME);
  }
  const optimization = semanticFacts && !packageSource && viewNameAvailable;
  const reason = !semanticFacts
    ? "library source is not configured for optimization"
    : packageSource
      ? "as-str package source is never self-optimized"
      : !viewNameAvailable
        ? "source binds the str name"
        : "source admitted";
  return {
    semanticFacts,
    optimization,
    packageSource,
    viewNameAvailable,
    requestedViewNames,
    reason,
  };
}
