import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFixture } from "./harness.mjs";
for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  for (const mode of ["global", "single", "auto"]) {
    const compiled = compileFixture("review-external-effects", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    let result;
    let calls = 0;
    result = await WebAssembly.instantiate(readFileSync(compiled.wasm), {
      env: {
        abort() {
          throw new Error("AssemblyScript abort");
        },
      },
      "review-external-effects": {
        change(pointer) {
          calls++;
          new DataView(result.instance.exports.memory.buffer).setUint16(
            pointer + 2,
            120,
            true,
          );
        },
      },
    });
    assert.equal(result.instance.exports.run(), 1, `${mode}/${build}`);
    assert.equal(calls, 1, `${mode}/${build}: host mutation executes once`);
  }
}
console.log("native snapshots survive opaque host calls");
