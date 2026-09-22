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
assert.match(safe, /Str\.sliceLength/);
assert.match(wat, /Str\.startsWithSpan/);
const fusedStart = wat.indexOf(
  "(func $transform/__tests__/fixtures/safety-regressions/fusedChain (param",
);
const fusedEnd = wat.indexOf("\n (func $", fusedStart + 1);
const fused = wat.slice(fusedStart, fusedEnd);
assert.doesNotMatch(fused, /String#(?:slice|substring)/);
const directStart = wat.indexOf(
  "(func $transform/__tests__/fixtures/safety-regressions/directIndexOf (param",
);
const directEnd = wat.indexOf("\n (func $", directStart + 1);
const directQuery = wat.slice(directStart, directEnd);
assert.match(directQuery, /Str\.indexOf/);
const localSpanStart = wat.indexOf(
  "(func $transform/__tests__/fixtures/safety-regressions/localSpanChain (param",
);
const localSpanEnd = wat.indexOf("\n (func $", localSpanStart + 1);
const localSpan = wat.slice(localSpanStart, localSpanEnd);
assert.match(localSpan, /Str\.sliceSpan/);
assert.doesNotMatch(localSpan, /String#(?:slice|substring)/);
const localQueryStart = wat.indexOf(
  "(func $transform/__tests__/fixtures/safety-regressions/localSpanQuery (param",
);
const localQueryEnd = wat.indexOf("\n (func $", localQueryStart + 1);
const localQuery = wat.slice(localQueryStart, localQueryEnd);
assert.match(localQuery, /Str\.startsWithSpan/);
assert.doesNotMatch(localQuery, /String#slice|Str#constructor/);
const reassignedStart = wat.indexOf(
  "(func $transform/__tests__/fixtures/safety-regressions/reassignedOwner (param",
);
const reassignedEnd = wat.indexOf("\n (func $", reassignedStart + 1);
const reassigned = wat.slice(reassignedStart, reassignedEnd);
assert.doesNotMatch(reassigned, /Str\.[A-Za-z]+Span/);
const trimStart = wat.indexOf(
  "(func $transform/__tests__/fixtures/safety-regressions/nativeTrimLength (result",
);
const trimEnd = wat.indexOf("\n (func $", trimStart + 1);
assert.match(wat.slice(trimStart, trimEnd), /String#trim/);
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
