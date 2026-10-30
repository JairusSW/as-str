import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFixture, instantiate } from "./harness.mjs";
import { instantiateRuntime } from "../../scripts/lib/wasm-runtime.mjs";
const positions = [-2147483648, -2, -1, 0, 1, 2, 3, 7, 20, 2147483647];
for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const baseline = await instantiate(
    compileFixture("native-view-search", {
      mode: "global",
      suffix: `global-${build}`,
      extra: [...extra, "--use", "AS_STR_NATIVE_BASELINE=1"],
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const module = await instantiate(
      compileFixture("native-view-search", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    let count = 0;
    for (let owner = 0; owner < 8; owner++)
      for (let needle = 0; needle < 8; needle++)
        for (const position of positions)
          for (let operation = 0; operation < 5; operation++) {
            assert.equal(
              module.instance.exports.query(owner, needle, position, operation),
              baseline.instance.exports.query(
                owner,
                needle,
                position,
                operation,
              ),
              `${mode}/${build}/${owner}/${needle}/${position}/${operation}`,
            );
            count++;
          }
    assert.equal(module.instance.exports.effects(), 1123);
    for (const position of positions)
      for (const name of ["positionedPacked", "positionedView"])
        assert.equal(
          module.instance.exports[name](position),
          baseline.instance.exports[name](position),
          `${mode}/${build}/${name}/${position}`,
        );
    console.log(
      `${mode}/${build}: ${count} native/view search comparisons passed`,
    );
  }
}
for (const simd of [false, true])
  for (const mode of ["global", "auto", "single"]) {
    const extra = [
      "-O3",
      "--noAssert",
      "--exportRuntime",
      "--use",
      "ASC_RTRACE=1",
      "--enable",
      "bulk-memory",
      simd ? "--enable" : "--disable",
      "simd",
    ];
    if (mode === "global") extra.push("--use", "AS_STR_NATIVE_BASELINE=1");
    const compiled = compileFixture("native-view-search", {
      mode,
      suffix: `alloc-${mode}-${simd}`,
      extra,
    });
    const runtime = await instantiateRuntime(
      await WebAssembly.compile(readFileSync(compiled.wasm)),
    );
    assert.ok(runtime.counts().allocs > 0);
    runtime.exports.__collect();
    runtime.resetCounts();
    assert.equal(runtime.exports.allocations(), 11);
    assert.deepEqual(
      runtime.counts(),
      { allocs: mode === "global" ? 5 : 0, resizes: 0 },
      `${mode}/SIMD=${simd}`,
    );
  }
console.log(
  "native/view search order preserved; view needles require no materialization allocations",
);
