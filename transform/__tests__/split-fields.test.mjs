import assert from "node:assert/strict";
import { compileFixture, functionBody, instantiate } from "./harness.mjs";

const cases = {
  viewSplitMutation: [[]],
  nativeSplitMutation: [[]],
  namespacedSplitOwner: [[]],
  firstKey: [[" name = x"], ["a"], [""], ["=b"], ["key=v=w"]],
  pathOnly: [["/a/b?x=1"], ["/plain"], ["?"], [""]],
  fieldCount: [["a,b,,c"], [""], [",,"], ["a::b::c"]],
  fieldAt: [
    ["a,bc,d", 1],
    ["a,bc,d", 2],
    ["a,bc,d", 3],
    ["a,bc,d", -1],
    ["", 0],
  ],
  multiUnit: [["x::mid  ::y"], ["x::"], ["x"], ["::mid"]],
  fieldViews: [["axyz;b"], ["q"], [";x"]],
  keyValues: [["a=1; b=2;c;a"], [""], ["=;;b=x=y"]],
  cursorCount: [["a,b,c,d"], [""], [" ,,,,, "]],
  userSplit: [[0], [1], [2]],
  headerArray: [["Host: example "], ["nocolon"], ["a:b:c"]],
  literalArray: [[0], [1]],
  missingField: [["a,b,c,d"], ["a,b"]],
  arrayEscapes: [
    ["p,q,r", 1],
    ["p,q,r", 7],
  ],
};
const fixture = "transform/__tests__/fixtures/split-fields";

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
    const result = exports[name](...args);
    // A returned string is compared by content, not by address.
    if (name !== "pathOnly") return result;
    const pointer = result >>> 0;
    const length =
      new Uint32Array(exports.memory.buffer, pointer - 4, 1)[0] >>> 1;
    return String.fromCharCode(
      ...new Uint16Array(exports.memory.buffer, pointer, length),
    );
  } catch (error) {
    // A missing field throws like indexing the native split result, though
    // from the runtime's source location rather than the array's.
    return `throws: ${error.message.replace(/ \(\d+:\d+\)$/, "")}`;
  } finally {
    for (const pointer of pinned) exports.__unpin(pointer);
  }
}

for (const [build, extra] of [
  ["debug", ["--exportRuntime"]],
  ["release", ["-O3", "--noAssert", "--enable", "simd", "--exportRuntime"]],
]) {
  const baseline = await instantiate(
    compileFixture("split-fields", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("split-fields", {
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
    if (build !== "debug") continue;
    // A trailing space selects the definition rather than its export entry.
    for (const name of [
      "firstKey",
      "pathOnly",
      "fieldCount",
      "fieldAt",
      "multiUnit",
      "fieldViews",
      "cursorCount",
      "headerArray",
      "literalArray",
      "missingField",
      "packedReceiverLoop",
    ])
      assert.doesNotMatch(
        functionBody(compiled.wat, `${fixture}/${name} `),
        /String#split|String#(?:trim\w*|slice)/,
        `${mode}/${name} must read fields in place`,
      );
    assert.match(
      functionBody(compiled.wat, `${fixture}/userSplit `),
      /Splitter#split/,
    );
    // A field passed whole to a native parameter keeps the array native for
    // every loop over it: the one split is the array itself.
    assert.equal(
      (
        functionBody(compiled.wat, `${fixture}/fieldLoops `).match(
          /String#split/g,
        ) ?? []
      ).length,
      1,
      `${mode}: one native split remains`,
    );
    // A counter written in the body, or an index other than the counter,
    // keeps the native array.
    assert.equal(
      (
        functionBody(compiled.wat, `${fixture}/irregularLoops `).match(
          /String#split/g,
        ) ?? []
      ).length,
      2,
      `${mode}: irregular loops stay native`,
    );
    // Arrays indexed by variables, written, replaced or passed on stay native.
    // A changing receiver can now be captured once and read in place.
    assert.equal(
      (
        functionBody(compiled.wat, `${fixture}/arrayEscapes `).match(
          /String#split/g,
        ) ?? []
      ).length,
      5,
      `${mode}: escaping split arrays stay native`,
    );
  }
}
console.log("literal-separated split fields are read in place");
