import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";
const cases = {
  "switch-cases": {
    localCase: 2,
    defaultCase: 3,
    unresolvedShadow: 3,
    directLocal: 2,
    directDefault: 3,
    insideBlock: 2,
    outsideBlock: 8,
    caseLabel: 3,
    insideSpan: 98,
    outsideSpan: 101,
  },
  manual: { run: 1 },
  nullable: { run: 1 },
  scope: { switchShadow: 3, namespaceShadow: 73 },
  containers: {
    constructed: 3,
    topLevel: 3,
    voidStatement: 3,
    objectLiteral: 3,
    template: 1,
    callDefault: 3,
    arrayLiteral: 3,
    ternary: 3,
    comma: 3,
  },
  defaults: { run: 6 },
  identity: { check: 0, repeatedCheck: 0, returnedCheck: 0 },
};
for (const [fixture, expected] of Object.entries(cases)) {
  if (process.argv[2] && process.argv[2] !== fixture) continue;
  for (const [build, extra] of [
    ["debug", []],
    ["release", ["-O3", "--noAssert", "--enable", "simd"]],
  ]) {
    for (const mode of ["global", "single", "auto"]) {
      const module = await instantiate(
        compileFixture(`review-${fixture}`, {
          mode,
          suffix: `${mode}-${build}`,
          extra,
        }).wasm,
      );
      for (const [name, value] of Object.entries(expected))
        assert.equal(
          module.instance.exports[name](),
          value,
          `${fixture}/${mode}/${build}/${name}`,
        );
    }
  }
}
console.log("review regressions passed");
