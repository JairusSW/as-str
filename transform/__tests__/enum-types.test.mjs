import assert from "node:assert/strict";
import {
  Parser,
  NamedTypeNode,
  Node,
} from "assemblyscript/dist/assemblyscript.js";
import {
  configureSourceAdmission,
  admitSource,
} from "../lib/source-admission.js";
import { stringRepresentation } from "../lib/type-resolution.js";
import { compileFixture, instantiate, repo } from "./harness.mjs";
for (const name of ["str", "Str"]) {
  const parser = new Parser();
  parser.parseFile(`enum ${name} { Value = 7 }`, "enum-types.ts", true);
  configureSourceAdmission(parser.sources, repo);
  const source = parser.sources[0];
  const type = Node.createNamedType(
    Node.createSimpleTypeName(name, source.range),
    null,
    false,
    source.range,
  );
  assert.ok(type instanceof NamedTypeNode);
  assert.equal(
    stringRepresentation(type),
    "unknown",
    `${name} enum is not a view`,
  );
  if (name === "str")
    assert.equal(admitSource(source).viewNameAvailable, false);
  assert.deepEqual(
    admitSource(source, true).requestedViewNames,
    name === "str" ? [] : ["str"],
  );
}
for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
])
  for (const [fixture, expected] of [
    ["enum-helper-name", 7],
    ["enum-type-name", 16],
  ])
    for (const mode of ["global", "auto", "single"]) {
      const module = await instantiate(
        compileFixture(fixture, { mode, suffix: `${mode}-${build}`, extra })
          .wasm,
      );
      assert.equal(
        module.instance.exports.run(),
        expected,
        `${fixture}/${mode}/${build}`,
      );
    }
console.log(
  "enum helper names and numeric enum types remain distinct from string views",
);
