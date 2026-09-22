import { createRequire } from "module";
const require = createRequire(import.meta.url);
function assemblyScriptVersion() {
  try {
    const metadata = require("assemblyscript/package.json");
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(metadata.version ?? "");
    return match
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : null;
  } catch {
    return null;
  }
}
const ASSEMBLYSCRIPT_VERSION = assemblyScriptVersion();
export function nativeLengthFusionIsCompatible(method) {
  if (method !== "trim") return true;
  const version = ASSEMBLYSCRIPT_VERSION;
  if (!version) return false;
  const [major, minor, patch] = version;
  return major > 0 || minor > 28 || (minor === 28 && patch > 20);
}
