import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { compileFixture, instantiate, repo } from "./harness.mjs";

const name = "receiver-effects.tmp";
const filename = path.join(repo, `transform/__tests__/fixtures/${name}.ts`);
const receivers = [
  ["view_to_native", "const value = str.from(text);", "value.toString()"],
  ["local", "const value = text;", "value"],
  ["getter", "const value = new EffectGetter(text);", "value.text"],
  ["field", "const value = new EffectField(text);", "value.text"],
  ["array", "const value = [text];", "value[choose()]"],
  ["call", "", "getText(text)"],
  ["parenthesized", "const value = text;", "(value)"],
  [
    "conditional",
    "const value = text;",
    '(choose() == 0 ? value : "fallback")',
  ],
];
const operations = [
  ["slice", "slice(0, bound())"],
  ["substring", "substring(0, bound())"],
  ["substr", "substr(0, bound())"],
  ["trim", "trim()"],
  ["trimStart", "trimStart()"],
  ["trimEnd", "trimEnd()"],
  ["charAt", "charAt(choose())"],
  ["at", "at(choose())"],
];
let source = `let effects: i32 = 0;
const inputs = ["abcX", " abc ", "", "日本語😀", "\\ud800abc", "İABC"];
function choose(): i32 { effects++; return 0; }
function bound(): i32 { effects++; return 3; }
function getText(text: string): string { effects++; return text; }
function other(): string { effects++; return effects == 1 ? "abcX" : "abc"; }
class EffectGetter {
  constructor(public backing: string) {}
  get text(): string { effects++; return this.backing; }
}
class EffectField { constructor(public text: string) {} }
`;
const names = [];
for (const [receiverName, setup, receiver] of receivers) {
  for (const [operationName, operation] of operations) {
    for (const consumer of [
      "length",
      "left",
      "right",
      "argument",
      "chain",
      "compare",
    ]) {
      const id = `${receiverName}_${operationName}_${consumer}`;
      const expression = `${receiver}.${operation}`;
      let body;
      if (consumer === "compare")
        body = `const score = ${expression}.localeCompare(other());`;
      if (consumer === "length")
        body = `const result = ${expression}; const score = result.length;`;
      if (consumer === "left")
        body = `const score = ${expression} == other() ? 7 : 13;`;
      if (consumer === "right")
        body = `const score = other() == ${expression} ? 7 : 13;`;
      if (consumer === "argument") {
        source += `function match_${id}(value: string): i32 { return value.length * 7 + value.charCodeAt(0); }\n`;
        body = `const score = match_${id}(${expression});`;
      }
      if (consumer === "chain")
        body = `const score = ${expression}.trim().slice(0, 2).length;`;
      source += `export function ${id}(input: i32): i32 {
        effects = 0; const text = inputs[input]; ${setup}
        ${body} return score + 1000 * effects;
      }\n`;
      names.push(id);
    }
  }
}
writeFileSync(filename, source);
let passed = false;
const failures = [];
try {
  for (const [build, extra] of [
    ["debug", []],
    ["release", ["-O3", "--noAssert", "--enable", "simd"]],
  ]) {
    const baselineFile = compileFixture(name, {
      mode: "global",
      suffix: `baseline-${build}`,
      extra,
    }).wasm;
    let baseline = await instantiate(baselineFile);
    for (const mode of ["auto", "single"]) {
      const optimizedFile = compileFixture(name, {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm;
      let optimized = await instantiate(optimizedFile);
      for (const id of names)
        for (let input = 0; input < 6; input++) {
          const label = `${mode}/${build}/${id}/${input}`;
          let expected, actual;
          try {
            expected = { value: baseline.instance.exports[id](input) };
          } catch (error) {
            expected = { error: error.message.replace(/ \(\d+:\d+\)$/, "") };
            baseline = await instantiate(baselineFile);
          }
          try {
            actual = { value: optimized.instance.exports[id](input) };
          } catch (error) {
            actual = { error: error.message.replace(/ \(\d+:\d+\)$/, "") };
            optimized = await instantiate(optimizedFile);
          }
          if (JSON.stringify(actual) !== JSON.stringify(expected))
            failures.push({ label, expected, actual });
        }
      console.log(
        `${mode}/${build}: ${names.length * 6} receiver/effect comparisons checked`,
      );
    }
  }
  writeFileSync(
    path.join(repo, "build/receiver-effects-results.json"),
    JSON.stringify({ comparisons: names.length * 6 * 4, failures }, null, 2) +
      "\n",
  );
  assert.equal(
    failures.length,
    0,
    JSON.stringify(failures.slice(0, 12), null, 2),
  );
  passed = true;
} finally {
  if (passed) unlinkSync(filename);
  else
    writeFileSync(path.join(repo, "build/receiver-effects-failure.ts"), source);
}
