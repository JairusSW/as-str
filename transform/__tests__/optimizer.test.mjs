import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Parser } from "assemblyscript/dist/assemblyscript.js";
import { admitSource } from "../lib/source-admission.js";
import { compileFixture, functionBody } from "./harness.mjs";

const compiled = compileFixture("safety-regressions", { mode: "auto" });
const wat = compiled.wat;
const safe = functionBody(
  wat,
  "transform/__tests__/fixtures/safety-regressions/safeLength",
);
assert.match(safe, /Str\.trimLength/);
const array = functionBody(
  wat,
  "transform/__tests__/fixtures/safety-regressions/arraySliceLength",
);
assert.doesNotMatch(array, /Str\./);
for (const name of ["equalityOrder", "twoSlices", "lowercaseEquality"]) {
  const body = functionBody(
    wat,
    `transform/__tests__/fixtures/safety-regressions/${name}`,
  );
  assert.doesNotMatch(body, /equalsSpan|equalsIgnoreCaseSpan/);
}

const originalCwd = process.cwd();
const consumerRoot = mkdtempSync(
  path.join(tmpdir(), "as-str-source-admission-"),
);
try {
  process.chdir(consumerRoot);
  const parser = new Parser();
  parser.parseFile(
    'export function check(): i32 { return "abc".slice(1).length; }',
    "assembly/index.ts",
    true,
  );
  assert.equal(admitSource(parser.sources[0]).optimization, true);
} finally {
  process.chdir(originalCwd);
  rmSync(consumerRoot, { recursive: true, force: true });
}
console.log("transform optimizer safety checks passed");
