import { Source } from "assemblyscript/dist/assemblyscript.js";

function libraryPrefixes(): string[] {
  return (process.env["AS_STR_LIBRARY_PREFIXES"] ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean);
}

export function sourceIsOptimizable(source: Source): boolean {
  return (
    (!source.isLibrary && !source.internalPath.startsWith("~lib")) ||
    libraryPrefixes().some((prefix) =>
      source.internalPath.startsWith(prefix),
    )
  );
}
