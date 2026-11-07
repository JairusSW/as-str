import { Source } from "assemblyscript/dist/assemblyscript.js";
import { readFileSync, realpathSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const PACKAGE_NAME = "as-str";

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
const sourceGraphs = new WeakMap<Source, readonly Source[]>();

export function sourcesFor(source: Source): readonly Source[] {
  return sourceGraphs.get(source) ?? [source];
}

export function configureSourceAdmission(
  sources: readonly Source[],
  baseCWD: string,
): void {
  const base = path.resolve(baseCWD);
  for (const source of sources) {
    sourceGraphs.set(source, sources);
    if (sourceBases.get(source) !== base) packageSources.delete(source);
    sourceBases.set(source, base);
  }
}

export function isPackageSource(source: Source): boolean {
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

// Library paths also name third-party packages. Trust only the compiler's
// actual standard sources, not every source under the ~lib prefix.
const standardRoot = path.resolve(
  fileURLToPath(import.meta.resolve("assemblyscript/dist/assemblyscript.js")),
  "..",
  "..",
  "std",
  "assembly",
);
const standardSources = new WeakMap<Source, boolean>();
export function isStandardSource(source: Source): boolean {
  const known = standardSources.get(source);
  if (known !== undefined) return known;
  let trusted = false;
  const name = source.internalPath;
  if (name.startsWith("~lib/") && !name.includes("..")) {
    try {
      trusted =
        source.text ===
        readFileSync(path.join(standardRoot, name.slice(5) + ".ts"), "utf8");
    } catch {
      trusted = false;
    }
  }
  standardSources.set(source, trusted);
  return trusted;
}
