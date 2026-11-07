import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFixture, instantiate, functionBody, repo } from "./harness.mjs";
for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  for (const mode of ["global", "single", "auto"]) {
    const library = compileFixture("review-library-effects", {
      mode,
      suffix: `${mode}-${build}`,
      extra: [
        ...extra,
        "--path",
        `${repo}/transform/__tests__/fixtures/libraries`,
      ],
    });
    const { instance } = await instantiate(library.wasm);
    for (const name of [
      "run",
      "nestedCall",
      "constructed",
      "indirect",
      "virtualCall",
    ])
      assert.equal(
        instance.exports[name](),
        1,
        `${mode}/${build}: library ${name}`,
      );
    if (mode === "auto" && build === "debug") {
      for (const name of ["pureControl", "pureConstructor"]) {
        const body = functionBody(
          library.wat,
          `transform/__tests__/fixtures/review-library-effects/${name}`,
        );
        assert.ok(
          !body.includes("String#slice") && !body.includes("Str#slice"),
          `${name}: pure excluded helpers retain scalarization`,
        );
      }
    }
    const hidden = await instantiate(
      compileFixture("review-hidden-effects", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    assert.equal(
      hidden.instance.exports.run(),
      1,
      `${mode}/${build}: hidden mutation`,
    );
    const compiled = compileFixture("review-external-effects", {
      mode,
      suffix: `${mode}-${build}`,
      extra: [
        ...extra,
        "--path",
        `${repo}/transform/__tests__/fixtures/libraries`,
      ],
    });
    let result;
    let calls = 0;
    const change = (pointer) => {
      calls++;
      new DataView(result.instance.exports.memory.buffer).setUint16(
        pointer + 2,
        120,
        true,
      );
    };
    result = await WebAssembly.instantiate(readFileSync(compiled.wasm), {
      env: {
        abort() {
          throw new Error("AssemblyScript abort");
        },
      },
      "review-external-effects": { change },
      index: { hostChange: change },
    });
    assert.equal(result.instance.exports.run(), 1, `${mode}/${build}`);
    assert.equal(calls, 1, `${mode}/${build}: host mutation executes once`);
    assert.equal(
      result.instance.exports.runLibrary(),
      1,
      `${mode}/${build}: excluded host declaration`,
    );
    assert.equal(
      calls,
      2,
      `${mode}/${build}: library host mutation executes once`,
    );
  }
}
console.log("native snapshots survive opaque host calls");
