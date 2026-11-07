import assert from "node:assert/strict";
import { compileFixture, functionBody, instantiate } from "./harness.mjs";

const cases = {
  callForms: [-2147483648, -1, 0, 1, 2, 3, 4, 5, 6, 7, 100],
  elementForms: [-1, 0, 1, 5, 6, 7],
  switchForm: [-1, 0, 1, 3, 4, 7],
  scalarLocal: [-1, 0, 1, 2, 4, 9],
  typedScalarLocal: [0, 2, 9],
  reassignedLocal: [0, 1, 9],
  otherUseLocal: [0, 1, 9],
  shadowedLocal: [0, 1, 2],
  userClass: [0, 1],
  effects: [0, 1, 9],
  ordering: [-1, 0, 1, 2, 3, 4, 5, 6, 100],
};
// A trailing space selects the definition rather than its export entry.
const fixture = "transform/__tests__/fixtures/char-comparisons";

for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const baseline = await instantiate(
    compileFixture("char-comparisons", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("char-comparisons", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const candidate = await instantiate(compiled.wasm);
    for (const [name, inputs] of Object.entries(cases))
      for (const input of inputs)
        assert.equal(
          candidate.instance.exports[name](input),
          baseline.instance.exports[name](input),
          `${mode}/${build}/${name}(${input})`,
        );
    if (build !== "debug") continue;
    // One-unit comparisons read the code unit instead of allocating a string.
    for (const name of [
      "elementForms",
      "switchForm",
      "scalarLocal",
      "typedScalarLocal",
      "effects",
      "ordering",
    ])
      assert.doesNotMatch(
        functionBody(compiled.wat, `${fixture}/${name} `),
        /String#charAt|Str\.charAt/,
        `${mode}/${name} must not materialize a character`,
      );
    // A two-unit literal can never match, but it is left to the native compare.
    assert.match(
      functionBody(compiled.wat, `${fixture}/callForms `),
      /String#charAt/,
    );
    assert.match(
      functionBody(compiled.wat, `${fixture}/userClass `),
      /Box#charAt/,
    );
  }
}
console.log("one-unit string comparisons read code units without allocating");
