import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";
const lengths = [
  0, 1, 3, 4, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255,
  256, 257,
];
for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const baseline = await instantiate(
    compileFixture("long-ordering", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const candidate = await instantiate(
      compileFixture("long-ordering", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    let count = 0;
    for (const length of lengths)
      for (let mismatch = -1; mismatch < length; mismatch++)
        for (let shape = 0; shape < 3; shape++) {
          assert.equal(
            candidate.instance.exports.query(length, mismatch, shape),
            baseline.instance.exports.query(length, mismatch, shape),
            `${mode}/${build}/${length}/${mismatch}/${shape}`,
          );
          count++;
        }
    console.log(`${mode}/${build}: ${count} long ordering comparisons passed`);
  }
}
