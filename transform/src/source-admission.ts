import { ImportStatement, Source } from "assemblyscript/dist/assemblyscript.js";

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

export interface SourceAdmission {
  readonly semanticFacts: boolean;
  readonly optimization: boolean;
  readonly packageSource: boolean;
  readonly viewNameAvailable: boolean;
  readonly requestedViewNames: readonly string[];
  readonly reason: string;
}

function libraryPrefixes(): string[] {
  return (process.env["AS_STR_LIBRARY_PREFIXES"] ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);
}

function sourceIsConfigured(source: Source): boolean {
  return (
    (!source.isLibrary && !source.internalPath.startsWith("~lib")) ||
    libraryPrefixes().some((prefix) => source.internalPath.startsWith(prefix))
  );
}

function isPackageSource(source: Source): boolean {
  if (OWN_SOURCES.has(source.normalizedPath)) return true;
  const internalPath = source.internalPath.replace(/\.ts$/, "");
  if (internalPath === `~lib/${PACKAGE_NAME}/index`) return true;
  const libraryPrefix = `~lib/${PACKAGE_NAME}/`;
  return (
    internalPath.startsWith(libraryPrefix) &&
    OWN_SOURCES.has(internalPath.slice(libraryPrefix.length) + ".ts")
  );
}

function importedNames(source: Source): Set<string> {
  const names = new Set<string>();
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

/**
 * Decides every source-participation question used by semantic analysis,
 * optimization, and import injection. Callers consume the decision rather
 * than rebuilding package, library, and name-safety policy.
 */
export function admitSource(
  source: Source,
  forcedImport = false,
): SourceAdmission {
  const semanticFacts = sourceIsConfigured(source);
  const packageSource = isPackageSource(source);
  const already = importedNames(source);
  const viewNameAvailable =
    already.has(VIEW_NAME) || !VIEW_BINDS.test(source.text);
  const requestedViewNames: string[] = [];
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
