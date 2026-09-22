import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";

for (const mode of ["global", "single", "auto"]) {
  for (const [variant, flags] of [
    ["scalar", []],
    ["simd-opt", ["--enable", "simd", "--optimize"]],
  ]) {
    const compiled = compileFixture("safety-regressions", {
      mode,
      suffix: `${mode}-${variant}-noassert`,
      extra: ["--noAssert", ...flags],
    });
    const { instance } = await instantiate(compiled.wasm);
    const e = instance.exports;
    assert.equal(e.arraySliceLength(), 3, mode);
    assert.equal(e.equalityOrder(), 1, mode);
    assert.equal(e.lowercaseEquality(), 0, mode);
    assert.equal(e.twoSlices(), 1, mode);
    assert.equal(e.betweenEmpty(), 0, mode);
    assert.equal(e.malformedTailCount(), 11, mode);
    assert.equal(e.malformedTailCodePoint(), 0xfffd, mode);
    for (const name of [
      "invalidUtf16Range",
      "invalidUtf8Range",
      "invalidUtf8Buffer",
      "invalidGenericReceiver",
      "oversizedRepeat",
      "oversizedStringBytes",
      "oversizedBufferBytes",
      "negativeRepeat",
      "atOutOfRange",
    ]) {
      assert.throws(() => e[name](), undefined, `${mode}/${name}`);
    }
  }
}
console.log("safety regression cases passed");
