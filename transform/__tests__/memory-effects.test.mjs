import assert from "node:assert/strict";
import { compileFixture, instantiate, functionBody } from "./harness.mjs";
for (const [build, flags] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert"]],
]) {
  for (const mode of ["global", "single", "auto"]) {
    const compiled = compileFixture("review-memory-effects", {
      mode,
      suffix: `${mode}-${build}`,
      extra: ["--enable", "simd", "--enable", "threads", ...flags],
    });
    const { instance } = await instantiate(compiled.wasm);
    for (const name of [
      "fill",
      "copy",
      "simd",
      "atomicWrite",
      "encodeUnsafe",
      "encodeUnsafe16",
    ])
      assert.equal(instance.exports[name](), 1, `${mode}/${build}/${name}`);
    if (mode !== "global" && build === "debug") {
      const body = functionBody(
        compiled.wat,
        "transform/__tests__/fixtures/review-memory-effects/pureControl",
      );
      assert.ok(
        !body.includes("String#slice") && !body.includes("Str#slice"),
        "user methods named memory.fill remain pure",
      );
    }
  }
}
console.log("namespaced memory operations preserve native snapshots");
