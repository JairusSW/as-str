import { ImportStatement, Source } from "assemblyscript/dist/assemblyscript.js";
import { readFileSync, realpathSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
export const PACKAGE_SOURCE_FILES = [
  "index.ts",
  "assembly/index.ts",
  "assembly/str.ts",
  "assembly/str8.ts",
  "assembly/util.ts",
  "assembly/util8.ts",
] as const;
const OWN_SOURCES = new Set<string>(PACKAGE_SOURCE_FILES);

const PACKAGE_ROOT = realpathSync(
  path.resolve(fileURLToPath(import.meta.url), "..", "..", ".."),
);
const sourceBases = new WeakMap<Source, string>();
const packageSources = new WeakMap<Source, boolean>();

export function configureSourceAdmission(
  sources: readonly Source[],
  baseCWD: string,
): void {
  const base = path.resolve(baseCWD);
  for (const source of sources) {
    if (sourceBases.get(source) !== base) packageSources.delete(source);
    sourceBases.set(source, base);
  }
}

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
  const known = packageSources.get(source);
  if (known !== undefined) return known;
  const internalPath = source.internalPath.replace(/\.ts$/, "");
  const prefix = `~lib/${PACKAGE_NAME}/`;
  let owned =
    internalPath.startsWith(prefix) &&
    OWN_SOURCES.has(internalPath.slice(prefix.length) + ".ts");
  if (!owned && !internalPath.startsWith("~lib")) {
    try {
      const file = realpathSync(
        path.resolve(
          sourceBases.get(source) ?? process.cwd(),
          source.normalizedPath,
        ),
      );
      const relative = path
        .relative(PACKAGE_ROOT, file)
        .split(path.sep)
        .join("/");
      // A virtual application source may use the same filename as a runtime file.
      owned =
        OWN_SOURCES.has(relative) && source.text === readFileSync(file, "utf8");
    } catch {
      owned = false;
    }
  }
  packageSources.set(source, owned);
  return owned;
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
