import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";
const cases = {
  "virtual-effects": { run: 1, baseControl: 0, constructorDispatch: 1 },
  "mutating-call": {
    direct: 1,
    local: 1,
    laterArgument: 1,
    scalarArgument: 98,
    afterStatement: 1,
    callbackArray: 1,
    callbackArgument: 1,
    genericArgument: 1,
    getter: 1,
    setter: 1,
    imported: 1,
    constructed: 1,
    returnedCallback: 1,
    manualView: 1,
    fieldInitializer: 1,
    defaultEffect: 1,
    inheritedConstructor: 1,
  },
  "callee-containers": {
    callResult: 3,
    indexedCallee: 3,
    commaCallee: 3,
    calleeOrder: 12343,
    indexOrder: 1243,
  },
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
