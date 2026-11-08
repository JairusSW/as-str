import assert from "node:assert/strict";
import { Parser } from "assemblyscript/dist/assemblyscript.js";
import { configureSourceAdmission } from "../lib/source-admission.js";
import { optimizeSources } from "../lib/optimizer.js";
import { repo } from "./harness.mjs";

// A generated function exercises both classification passes over many distinct
// bindings. Timing is measured separately under the shared host lock.
const count = 1024;
const parser = new Parser();
parser.parseFile(
  `export function run(input: string): i32 { let sum = 0; ${Array.from(
    { length: count },
    (_, i) => `const part${i} = input.slice(0, 8); sum += part${i}.length;`,
  ).join("\n")} return sum; }`,
  "analysis-scaling.ts",
  true,
);
configureSourceAdmission(parser.sources, repo);
const result = optimizeSources(parser.sources);
assert.equal(
  result.diagnostics.filter((entry) =>
    entry.reason.startsWith("scalarized length-only"),
  ).length,
  count,
);
console.log(`${count} distinct bindings retain length scalarization`);

// Packed owners must use the same assignment index instead of rescanning the
// whole function once per span. This checks the lowering, not elapsed time.
const packed = new Parser();
packed.parseFile(
  `export function run(input: string): i32 { let sum = 0; ${Array.from(
    { length: count },
    (_, i) =>
      `const part${i} = input.slice(0, 8); sum += part${i}.charCodeAt(0);`,
  ).join("\n")} return sum; }`,
  "packed-owner-scaling.ts",
  true,
);
configureSourceAdmission(packed.sources, repo);
const spans = optimizeSources(packed.sources);
assert.equal(
  spans.diagnostics.filter(
    (entry) =>
      entry.reason ===
      "scalarized non-escaping view into a packed pointer span",
  ).length,
  count,
);
console.log(`${count} distinct bindings retain packed spans`);
