import assert from "node:assert/strict";
import { compileFixture, functionBody, instantiate } from "./harness.mjs";

const cases = {
  earlyLine: [["abc"], ["a\nb"], [""], ["\nb"]],
  lineMethod: [["GET / HTTP\nHost"], ["GET /"], [""], ["nospace\n"]],
  extensions: [[]],
  prefixLength: [["abc"], [""]],
  computed: [["abc"]],
  reassignedUse: [["  abc  "]],
  eitherUse: [[0], [1]],
  identityUse: [["abc"]],
  exportedUse: [["abc"]],
  rawCaller: [[]],
  shadowReturn: [[]],
};
const fixture = "transform/__tests__/fixtures/span-returns";
const PACKED = (name, parameter) =>
  `${name} return -> view: returns a packed span of ${parameter}`;

// Arguments are pinned so allocating a later one cannot collect an earlier one.
function call(module, name, input) {
  const exports = module.instance.exports;
  const pinned = [];
  try {
    const args = input.map((value) => {
      if (typeof value !== "string") return value;
      const pointer = exports.__new(value.length << 1, 2) >>> 0;
      new Uint16Array(exports.memory.buffer, pointer, value.length).set(
        Array.from(value, (unit) => unit.charCodeAt(0)),
      );
      pinned.push(exports.__pin(pointer));
      return pointer;
    });
    return exports[name](...args);
  } finally {
    for (const pointer of pinned) exports.__unpin(pointer);
  }
}

for (const [build, extra] of [
  ["debug", ["--exportRuntime"]],
  ["release", ["-O3", "--noAssert", "--enable", "simd", "--exportRuntime"]],
]) {
  const baseline = await instantiate(
    compileFixture("span-returns", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("span-returns", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const candidate = await instantiate(compiled.wasm);
    for (const [name, inputs] of Object.entries(cases))
      for (const input of inputs)
        assert.equal(
          call(candidate, name, input),
          call(baseline, name, input),
          `${mode}/${build}/${name}(${JSON.stringify(input)})`,
        );
    if (build !== "debug" || mode !== "auto") continue;
    // Helpers whose every caller reads the result in place return spans.
    for (const [name, parameter] of [
      ["firstLine", "text"],
      ["extension", "name"],
    ]) {
      assert.ok(compiled.output.includes(PACKED(name, parameter)), name);
      assert.match(
        functionBody(compiled.wat, `${fixture}/${name} `),
        /\(result i64\)/,
      );
    }
    for (const name of ["lineMethod", "extensions"])
      assert.doesNotMatch(
        functionBody(compiled.wat, `${fixture}/${name} `),
        /String#(?:slice|trim)|Str#constructor/,
        `${name} must read the returned span in place`,
      );
    // A native caller, a computed argument, a reassigned parameter, two roots,
    // an identity, an exported function or a raw-pointer caller keep strings.
    for (const [name, parameter] of [
      ["prefix", "text"],
      ["computedArgument", "text"],
      ["reassigned", "text"],
      ["either", "left"],
      ["identity", "text"],
      ["exportedSlice", "text"],
      ["tail", "text"],
    ])
      assert.ok(!compiled.output.includes(PACKED(name, parameter)), name);
  }
}
console.log("helpers returning a span of their argument return packed spans");
