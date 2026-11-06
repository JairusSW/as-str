import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";

const PACKED = "scalarized non-escaping view into a packed pointer span";
const stable = ["constLocalSpan", "unassignedLetSpan", "constGlobalSpan"];
const unstable = [
  "reassignedLocalSpan",
  "appendedLocalSpan",
  "loopOwnerSpan",
  "mutableGlobalSpan",
  "shadowedLocalSpan",
  "shadowedGlobalSpan",
];
const exports = [
  "constLocal",
  "unassignedLet",
  "constGlobal",
  "reassignedLocal",
  "appendedLocal",
  "reassignedLoopOwner",
  "mutableGlobal",
  "shadowedLocal",
  "shadowedGlobal",
];

for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const baseline = await instantiate(
    compileFixture("span-owner-stability", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("span-owner-stability", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    for (const name of stable)
      assert.match(
        compiled.output,
        new RegExp(String.raw`\b${name} -> view: ${PACKED}`),
        `${mode}/${build}: ${name} has a stable owner and must stay packed`,
      );
    for (const name of unstable)
      assert.doesNotMatch(
        compiled.output,
        new RegExp(String.raw`\b${name} -> view: ${PACKED}`),
        `${mode}/${build}: ${name} must not pack a span over a mutable owner`,
      );
    const candidate = await instantiate(compiled.wasm);
    for (const name of exports)
      assert.equal(
        candidate.instance.exports[name](),
        baseline.instance.exports[name](),
        `${mode}/${build}/${name}`,
      );
  }
}
console.log("packed spans require owners that stay the same string");
