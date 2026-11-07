import assert from "node:assert/strict";
import { compileFixture, functionBody, instantiate } from "./harness.mjs";

const cases = {
  nativeTrimCompatibility: [[0], [1], [2], [3], [4], [5], [8], [16]],
  nativeEmptyChainIdentity: [[]],
  nativeChainIdentity: [[]],
  chainedLocal: [[]],
  chainedEquality: [[0], [3], [5], [6], [-2], [100]],
  chainedLength: [[0], [1], [2], [4], [-3], [100]],
  scalarizedRoot: [[]],
  argumentOrder: [[]],
  reassignedRoot: [[]],
  staticForms: [[]],
  literalRoot: [[]],
  userRoot: [[0], [1]],
  parameterRoot: [[]],
  nativeResults: [[-20], [-3], [0], [2], [5], [9], [100]],
  ownerAcrossCalls: [[-2], [0], [3], [40]],
  ternaryName: [[-1], [0], [4], [100]],
  ternaryLinks: [[0], [1]],
  ternaryLiteral: [[0], [1]],
  ternaryRoots: [[0], [1]],
  ternaryEscapes: [[0], [1]],
  packedParameterCallers: [[]],
  chainPairs: [[0], [5], [7], [100]],
  spanSwitch: [[-1], [0], [1], [3], [6], [11], [100]],
  concatenations: [[-3], [0], [2], [5], [100]],
  appendSpans: [[-2], [0], [3], [100]],
};
const SCALARIZED = "scalarized non-escaping view into a packed pointer span";
// A trailing space selects the definition rather than its export entry.
const fixture = "transform/__tests__/fixtures/span-chains";

for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const baseline = await instantiate(
    compileFixture("span-chains", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("span-chains", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const candidate = await instantiate(compiled.wasm);
    for (const [name, inputs] of Object.entries(cases))
      for (const input of inputs)
        assert.equal(
          candidate.instance.exports[name](...input),
          baseline.instance.exports[name](...input),
          `${mode}/${build}/${name}(${input})`,
        );
    if (build !== "debug") continue;
    for (const line of ["4:9 value", "33:9 name", "34:9 value", "52:9 view"])
      assert.ok(
        compiled.output.includes(
          `span-chains.ts:${line} -> view: ${SCALARIZED}`,
        ),
        `${mode}: chain ${line} must pack into one span of its root`,
      );
    // Each branch of a same-root conditional is one span of that root.
    for (const name of ["ternaryName", "ternaryLinks", "ternaryLiteral"])
      assert.doesNotMatch(
        functionBody(compiled.wat, `${fixture}/${name} `),
        /String#(?:slice|substring|trim\w*)|Str#constructor/,
        `${mode}/${name} must pack its conditional`,
      );
    // A parameter that only roots packed spans stays native. The second
    // optimization round must not read generated span helpers as view uses.
    assert.doesNotMatch(
      functionBody(compiled.wat, `${fixture}/packedParameterCallers `),
      /Str\.from|Str#constructor/,
      `${mode}: callers must not wrap a packed-span root`,
    );
    // An escaping merge stays native rather than wrapping either branch.
    assert.doesNotMatch(
      functionBody(compiled.wat, `${fixture}/ternaryEscapes `),
      /Str#constructor|Str\.from/,
    );
    // Roots that change or are not strings keep their native chain.
    for (const line of ["58:9 view", "82:9 value"])
      assert.ok(
        !compiled.output.includes(
          `span-chains.ts:${line} -> view: ${SCALARIZED}`,
        ),
        `${mode}: chain ${line} must not pack`,
      );
    // Intermediate links neither copy nor allocate a view object.
    // Appending a span copies it once, into the result.
    assert.doesNotMatch(
      functionBody(compiled.wat, `${fixture}/appendSpans `),
      /String#(?:slice|substring|trim\w*)/,
      `${mode}: appended spans must not copy first`,
    );
    // Concatenation reads span operands in place: only the results copy.
    assert.doesNotMatch(
      functionBody(compiled.wat, `${fixture}/concatenations `),
      /String#(?:slice|substring|trim\w*)/,
      `${mode}: concatenation must not copy its operands`,
    );
    // A span switch selects its case by index; only the user class copies.
    const spanSwitch = functionBody(compiled.wat, `${fixture}/spanSwitch `);
    assert.match(spanSwitch, /Str\.caseIndexSpan/);
    assert.doesNotMatch(spanSwitch, /String#substring|__newBuffer/);
    for (const name of [
      "chainedLocal",
      "chainedEquality",
      "chainedLength",
      "nativeResults",
      "headerName",
    ])
      assert.doesNotMatch(
        functionBody(compiled.wat, `${fixture}/${name} `),
        /String#(?:slice|substring|substr|trim\w*)|Str#constructor/,
        `${mode}/${name} must not materialize a link`,
      );
  }
}
console.log("chains of span operations narrow one span of their root");
