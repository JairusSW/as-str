import assert from "node:assert/strict";
import path from "node:path";
import { computeImportBaseRel, normalizeBaseRel } from "../lib/imports.js";

assert.equal(
  normalizeBaseRel("../../.pnpm/as-str@0.3.0/node_modules/as-str"),
  "as-str",
);
assert.equal(
  computeImportBaseRel(
    "/workspace/app/src",
    "/workspace/app/node_modules/as-str",
    path.posix,
  ),
  "as-str",
);
assert.equal(
  computeImportBaseRel(
    "C:\\workspace\\app\\src",
    "C:\\workspace\\app\\node_modules\\as-str",
    path.win32,
  ),
  "as-str",
);
assert.equal(
  computeImportBaseRel(
    "/workspace/as-str/examples",
    "/workspace/as-str",
    path.posix,
  ),
  "..",
);

console.log("transform import path tests passed");
