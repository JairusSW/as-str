import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";

const baseline = compileFixture("differential-corpus", {
  optimize: false,
  suffix: "baseline",
});
const optimized = compileFixture("differential-corpus", {
  optimize: true,
  suffix: "optimized",
});
const baselineModule = await instantiate(baseline.wasm);
const optimizedModule = await instantiate(optimized.wasm);

for (const [name, inputs] of [
  ["asciiPipeline", [[]]],
  ["unicodePipeline", [[]]],
  ["branchPipeline", [[0], [1]]],
  ["recursivePipeline", [[]]],
  ["boundsPipeline", [[]]],
  ["scalarLengthPipeline", [[]]],
  ["scalarSpanPipeline", [[]]],
  ["packedCaseFoldPipeline", [[]]],
]) {
  for (const args of inputs) {
    assert.equal(
      optimizedModule.instance.exports[name](...args),
      baselineModule.instance.exports[name](...args),
      `${name} changed observable behavior for ${JSON.stringify(args)}`,
    );
  }
}

assert.match(optimized.output, /\[as-str\] summary:/);
console.log("transform differential corpus passed");
