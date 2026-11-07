import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";
const cases = {
  "split-safety": {
    fieldSet: 120,
    fieldAlias: 120,
    fieldHelper: 120,
    directViewIndex: 97,
    directViewSlice: 97,
    counterAssign: 4,
    parenthesizedField: 7,
    parenthesizedLength: 1,
  },
  "switch-shadow": { run: 1 },
  "char-barrier": { run: 1 },
};
for (const [fixture, expected] of Object.entries(cases)) {
  if (process.argv[2] && process.argv[2] !== fixture) continue;
  for (const [build, extra] of [
    ["debug", []],
    ["release", ["-O3", "--noAssert", "--enable", "simd"]],
  ]) {
    // Mixed view/string comparison is supplied by the automatic transforms.
    const modes =
      fixture === "char-barrier"
        ? ["single", "auto"]
        : ["global", "single", "auto"];
    for (const mode of modes) {
      const {
        instance: { exports },
      } = await instantiate(
        compileFixture(`review-${fixture}`, {
          mode,
          suffix: `${mode}-${build}`,
          extra,
        }).wasm,
      );
      for (const [name, value] of Object.entries(expected))
        assert.equal(
          exports[name](),
          value,
          `${fixture}/${mode}/${build}/${name}`,
        );
    }
  }
}
console.log(
  "split mutation, evaluation order, raw barriers and type hygiene passed",
);
