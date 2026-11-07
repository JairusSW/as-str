import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { compileFixture, functionBody, instantiate, repo } from "./harness.mjs";

const cases = {
  countWords: [["  the quick  brown fox "], [""], ["   "], ["one"], ["a b"]],
  forIncrementor: [["  abcdefg"], [""], ["x"]],
  siblingSpan: [[" abcdefxyz  "], ["abcxyz"], [""], ["  a"]],
  literalOwner: [[0], [8], [-5], [100]],
  otherOwner: [[" a ", "  bb "]],
  assignmentValue: [[" abcd "], [""]],
  literalAssignment: [["  ab "], [" abcdef "]],
  ownerReassigned: [["abcdef"], [""]],
  appendAssignment: [[" ab "]],
  sameOwnerSibling: [[" abcdefxyz  "], ["ab"], [""]],
  rowsByCursor: [["a,b\nc\nd,e,f"], [""], ["\n\n"], ["x\n"]],
  escapingRows: [["a,b\nc\nd,e,f"], [""], ["x\n"]],
};
const SCALARIZED = "scalarized non-escaping view into a packed pointer span";
const source = readFileSync(
  path.join(repo, "transform/__tests__/fixtures/span-cursors.ts"),
  "utf8",
).split("\n");
// Diagnostics name a binding by its declaration's line and column.
// The binding declared `offset` lines below a function's header.
function inFunction(name, offset, binding) {
  const header = source.findIndex((text) =>
    text.startsWith(`export function ${name}(`),
  );
  assert.notEqual(header, -1, name);
  const line = source[header + offset];
  return `span-cursors.ts:${header + offset + 1}:${line.indexOf(`${binding} =`) + 1} ${binding} -> view: ${SCALARIZED}`;
}
const packed = [
  inFunction("countWords", 2, "rest"),
  inFunction("forIncrementor", 2, "rest"),
  inFunction("literalOwner", 1, "view"),
  inFunction("sameOwnerSibling", 2, "part"),
  // `head` packs over `text`, so every assignment stays within one owner.
  inFunction("siblingSpan", 2, "part"),
  // A cursor and a conditional row over it pack together.
  inFunction("rowsByCursor", 1, "rest"),
  inFunction("rowsByCursor", 5, "row"),
];
// Another owner, a used assignment value, a literal, a changed owner or an
// append each need the class-backed view or the native string.
const unpacked = [
  inFunction("otherOwner", 1, "view"),
  inFunction("assignmentValue", 1, "rest"),
  inFunction("literalAssignment", 1, "rest"),
  inFunction("ownerReassigned", 2, "rest"),
  inFunction("appendAssignment", 1, "rest"),
  // An escaping row unpacks the cursor it was optimistically paired with.
  inFunction("escapingRows", 1, "rest"),
  inFunction("escapingRows", 5, "row"),
];

// Arguments are pinned so allocating a later one cannot collect an earlier one.
function call(module, name, input) {
  const exports = module.instance.exports;
  const pinned = [];
  const args = input.map((value) => {
    if (typeof value !== "string") return value;
    const pointer = exports.__new(value.length << 1, 2) >>> 0;
    new Uint16Array(exports.memory.buffer, pointer, value.length).set(
      Array.from(value, (unit) => unit.charCodeAt(0)),
    );
    pinned.push(exports.__pin(pointer));
    return pointer;
  });
  try {
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
    compileFixture("span-cursors", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("span-cursors", {
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
    for (const expected of packed)
      assert.ok(compiled.output.includes(expected), `${mode}: ${expected}`);
    for (const rejected of unpacked)
      assert.ok(!compiled.output.includes(rejected), `${mode}: ${rejected}`);
    assert.doesNotMatch(
      functionBody(
        compiled.wat,
        "transform/__tests__/fixtures/span-cursors/countWords ",
      ),
      /String#(?:substring|trim\w*)|Str#constructor/,
      `${mode}: a moving cursor must not allocate`,
    );
  }
}
console.log("cursors over one owner move as packed spans");
