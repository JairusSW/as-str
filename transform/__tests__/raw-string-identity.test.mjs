import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";
for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const baseline = await instantiate(
    compileFixture("raw-string-identity", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const candidate = await instantiate(
      compileFixture("raw-string-identity", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    for (const name of [
      "repeatIdentity",
      "paddingIdentity",
      "emptyPaddingIdentity",
      "aliases",
      "lowercaseIdentity",
      "parameterIdentity",
    ])
      assert.equal(
        candidate.instance.exports[name](),
        baseline.instance.exports[name](),
        `${mode}/${build}/${name}`,
      );
  }
}
console.log(
  "raw string identity remains native through methods, aliases, and parameters",
);
