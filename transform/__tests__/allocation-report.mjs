import assert from "node:assert/strict";
import { compileFixture } from "./harness.mjs";

const baseline = compileFixture("allocation-corpus", {
  mode: "global",
  suffix: "baseline",
});
const optimized = compileFixture("allocation-corpus", {
  mode: "auto",
  suffix: "optimized",
});

function count(wat, pattern) {
  return (wat.match(pattern) ?? []).length;
}

const report = {
  baselineNativeCopyCalls: count(
    baseline.wat,
    /call \$~lib\/string\/String#(?:slice|substring|trim|trimStart|trimEnd|charAt)/g,
  ),
  optimizedNativeCopyCalls: count(
    optimized.wat,
    /call \$~lib\/string\/String#(?:slice|substring|trim|trimStart|trimEnd|charAt)/g,
  ),
  optimizedViewOperations: count(
    optimized.wat,
    /(?:call|block) \$assembly\/str\/Str(?:\.|#)(?:slice|substring|trim|trimStart|trimEnd|charAt)(?:(?:Length|Span(?:Of)?))?(?=<|\||\s)/g,
  ),
  optimizedViewObjectAllocations: count(
    optimized.wat,
    /call \$assembly\/str\/Str#constructor/g,
  ),
};

assert.ok(report.baselineNativeCopyCalls >= 6, JSON.stringify(report));
assert.equal(report.optimizedNativeCopyCalls, 0, JSON.stringify(report));
assert.ok(report.optimizedViewOperations >= 6, JSON.stringify(report));
assert.equal(report.optimizedViewObjectAllocations, 0, JSON.stringify(report));
console.log(JSON.stringify(report));
