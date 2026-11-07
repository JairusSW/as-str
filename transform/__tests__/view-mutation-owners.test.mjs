import assert from "node:assert/strict";
import { compileFixture, instantiate, functionBody } from "./harness.mjs";
const cases = {
  constructorControl: 65,
  arrayAliasView: 65,
  arrayAliasData: 65,
  genericData: 65,
  localView: 65,
  chainView: 65,
  aliasView: 65,
  dataWrite: 65,
  noGcControl: 65,
  stableControl: 65,
  userSetControl: 65,
  readAfterWrite: 66,
  readAfterHelper: 67,
};
for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  for (const mode of ["global", "single", "auto"]) {
    const compiled = compileFixture("view-mutation-owners", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const {
      instance: { exports },
    } = await instantiate(compiled.wasm);
    for (const [name, expected] of Object.entries(cases))
      assert.equal(exports[name](), expected, `${mode}/${build}/${name}`);
    if (mode !== "global" && build === "debug") {
      for (const name of [
        "stableControl",
        "userSetControl",
        "constructorControl",
      ]) {
        const body = functionBody(
          compiled.wat,
          `transform/__tests__/fixtures/view-mutation-owners/${name} `,
        );
        assert.match(
          body,
          /Str\.sliceSpan</,
          `${mode}: pure views stay packed`,
        );
        assert.doesNotMatch(
          body,
          /Str#slice/,
          `${mode}: pure views need no slice wrapper`,
        );
      }
    }
  }
}
console.log("mutable views retain backing owners and inferred view aliases");
