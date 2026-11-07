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
];
const OWN_SOURCES = new Set(PACKAGE_SOURCE_FILES);
const PACKAGE_ROOT = realpathSync(
  path.resolve(fileURLToPath(import.meta.url), "..", "..", ".."),
);
const sourceBases = new WeakMap();
const packageSources = new WeakMap();
const sourceGraphs = new WeakMap();
export function sourcesFor(source) {
  return sourceGraphs.get(source) ?? [source];
}
export function configureSourceAdmission(sources, baseCWD) {
  const base = path.resolve(baseCWD);
  for (const source of sources) {
    sourceGraphs.set(source, sources);
    if (sourceBases.get(source) !== base) packageSources.delete(source);
    sourceBases.set(source, base);
  }
}
export function isPackageSource(source) {
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
      owned =
        OWN_SOURCES.has(relative) && source.text === readFileSync(file, "utf8");
    } catch {
      owned = false;
    }
  }
  packageSources.set(source, owned);
  return owned;
}
const standardRoot = path.resolve(
  fileURLToPath(import.meta.resolve("assemblyscript/dist/assemblyscript.js")),
  "..",
  "..",
  "std",
  "assembly",
);
const standardSources = new WeakMap();
export function isStandardSource(source) {
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
