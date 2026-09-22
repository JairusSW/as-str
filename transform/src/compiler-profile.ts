import { createRequire } from "module";

interface PackageMetadata {
  version?: string;
}

const require = createRequire(import.meta.url);

function assemblyScriptVersion(): [number, number, number] | null {
  try {
    const metadata = require("assemblyscript/package.json") as PackageMetadata;
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(metadata.version ?? "");
    return match
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : null;
  } catch {
    return null;
  }
}

const ASSEMBLYSCRIPT_VERSION = assemblyScriptVersion();

/** Whether a native operation matches the corresponding as-str specialization. */
export function nativeLengthFusionIsCompatible(method: string): boolean {
  if (method !== "trim") return true;
  const version = ASSEMBLYSCRIPT_VERSION;
  if (!version) return false;
  const [major, minor, patch] = version;
  // AssemblyScript 0.28.10 through 0.28.20 shrink `size` while advancing the
  // leading offset, so trim() can retain leading whitespace.
  return major > 0 || minor > 28 || (minor === 28 && patch > 20);
}
