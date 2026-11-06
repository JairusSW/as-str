import assert from "node:assert/strict";
import { compileFixture, functionBody, instantiate } from "./harness.mjs";

const exports = [
  "moduleInitializers",
  "fieldInitializers",
  "expressionArrow",
  "callbackArrow",
  "nestedArrow",
  "blockAndArrow",
];

for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const baseline = await instantiate(
    compileFixture("captured-owner-contexts", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("captured-owner-contexts", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const candidate = await instantiate(compiled.wasm);
    for (const name of exports)
      assert.equal(
        candidate.instance.exports[name](),
        baseline.instance.exports[name](),
        `${mode}/${build}/${name}`,
      );
    if (mode === "auto" && build === "debug")
      // The owner only roots the backing string; callers must not wrap it.
      assert.match(
        functionBody(
          compiled.wat,
          "transform/__tests__/fixtures/captured-owner-contexts/score",
        ),
        /^\(func \S+ \(param \$0 i64\) \(param \$1 i32\) \(result i32\)/,
        "score must take a packed span with a native owner",
      );
  }
}
console.log(
  "packed span owners are captured in initializers, fields, and arrow bodies",
);
