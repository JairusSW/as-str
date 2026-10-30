import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";

const cases = [
  ["asciiPipeline", [[]]],
  ["unicodePipeline", [[]]],
  ["branchPipeline", [[0], [1]]],
  ["recursivePipeline", [[]]],
  ["boundsPipeline", [[]]],
  ["scalarLengthPipeline", [[]]],
  ["scalarSpanPipeline", [[]]],
  ["packedCaseFoldPipeline", [[]]],
  ["uppercaseLiteralPipeline", [[]]],
  ["unicodeLowercasePipeline", [[]]],
  ["conditionalLowercasePipeline", [[0], [1]]],
  ["lowercaseScalarPipeline", [[]]],
  ["comparisonBeforeLowercasePipeline", [[]]],
  ["twoSpansPipeline", [[0], [1]]],
  ["unicodeExpansionPipeline", [[]]],
  ["lowercaseInequalityPipeline", [[]]],
  ["splitLimitPipeline", [[-2147483648], [-1], [0], [1], [2], [2147483647]]],
];

for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const baseline = compileFixture("differential-corpus", {
    mode: "global",
    suffix: `baseline-${build}`,
    extra,
  });
  const baselineModule = await instantiate(baseline.wasm);
  for (const mode of ["auto", "single"]) {
    const optimized = compileFixture("differential-corpus", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const optimizedModule = await instantiate(optimized.wasm);
    for (const [name, inputs] of cases) {
      for (const args of inputs) {
        assert.equal(
          optimizedModule.instance.exports[name](...args),
          baselineModule.instance.exports[name](...args),
          `${mode}/${build}: ${name} changed behavior for ${JSON.stringify(args)}`,
        );
      }
    }
    assert.match(optimized.output, /\[as-str\] summary:/);
  }
}

console.log("transform differential corpus passed");
