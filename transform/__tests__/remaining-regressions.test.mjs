import assert from "node:assert/strict";
import { compileFixture, instantiate, repo } from "./harness.mjs";

const failures = [];

async function checkFixture(fixture, expected, extra = []) {
  for (const [build, buildFlags] of [
    ["debug", []],
    ["release", ["-O3", "--noAssert", "--enable", "simd"]],
  ])
    for (const mode of ["global", "single", "auto"]) {
      try {
        const compiled = compileFixture(fixture, {
          mode,
          suffix: `${mode}-${build}-remaining`,
          extra: [...buildFlags, ...extra],
        });
        const { instance } = await instantiate(compiled.wasm);
        for (const [name, value] of Object.entries(expected))
          assert.equal(
            instance.exports[name](),
            value,
            `${fixture}/${mode}/${build}/${name}`,
          );
      } catch (error) {
        failures.push(`${fixture}/${mode}/${build}: ${error.message}`);
      }
    }
}

await checkFixture("review-equality-order", { run: 1, notEqual: 0 });
await checkFixture("review-shadowed-u64", {
  run: 1,
  parameter: 2,
  returned: 2,
});
await checkFixture("review-shadowed-i32", { run: 1 });
await checkFixture("review-native-indexing", {
  run: 1,
  firstCode: 98,
  promotedString: 1,
  promotedLength: 105,
});
await checkFixture("review-shadowed-imports", {
  packed: 1,
  character: 1,
});
await checkFixture("review-shadowed-generic", { run: 1 });
await checkFixture("review-view-concat", { property: 1, indexing: 1 });
await checkFixture("review-mixed-packed-parameters", { run: 8, multiple: 10 });
await checkFixture("review-shadowed-string", { run: 5 });
await checkFixture("review-derived-native-indexing", {
  charAtResult: 1,
  sliceResult: 1,
  substringResult: 1,
  longerChain: 1,
  explicitView: 1,
});
await checkFixture("review-qualified-packed-call", { run: 5 });
await checkFixture("review-is-defined", {
  packedMember: 0,
  viewMember: 0,
  existingMember: 1,
});
await checkFixture("review-module-identity", { run: 4 });
await checkFixture("review-operator-mutation", {
  overloaded: 5,
  explicit: 5,
});
await checkFixture("review-static-native-args", {
  lowercaseReplace: 1,
  uppercaseReplace: 1,
  genericNeedle: 1,
  nativeReplacement: 1,
  nativePadding: 1,
  nativeSeparator: 1,
});
await checkFixture("review-callback-shadow", { runTrue: 3, runFalse: 13 });
await checkFixture("review-constructor-inference", {
  rest: 2,
  restExplicit: 2,
  inherited: 2,
  inheritedExplicit: 2,
  inheritedGenericView: 2,
  inheritedGenericNative: 2,
});
await checkFixture("review-default-parameter-promotion", {
  run: 14,
  explicitControl: 14,
});
await checkFixture("review-callback-property", {
  runTrue: 3,
  runFalse: 13,
  typedTrue: 3,
  typedFalse: 13,
});
await checkFixture("review-generic-static", {
  unresolved: 1,
  concreteControl: 1,
  inferredControl: 1,
  uppercaseControl: 1,
});
await checkFixture("review-accessor-write-type", {
  differentTypes: 2,
  setterOnly: 2,
});
await checkFixture("review-shadowed-string-literal", { run: 4 });
await checkFixture("review-between-last", {
  utf16Instance: 5,
  utf16Static: 5,
  utf16Length: 5,
  utf8Instance: 5,
  utf8Static: 5,
});

const priorPrefixes = process.env.AS_STR_LIBRARY_PREFIXES;
process.env.AS_STR_LIBRARY_PREFIXES = "~lib/review-count";
try {
  await checkFixture("review-library-alias", { run: 6 }, [
    "--path",
    `${repo}/transform/__tests__/fixtures/libraries`,
  ]);
  await checkFixture("review-library-namespace", { run: 6 }, [
    "--path",
    `${repo}/transform/__tests__/fixtures/libraries`,
  ]);
  await checkFixture("review-qualified-library", { run: 5 }, [
    "--path",
    `${repo}/transform/__tests__/fixtures/libraries`,
  ]);
} finally {
  if (priorPrefixes === undefined) delete process.env.AS_STR_LIBRARY_PREFIXES;
  else process.env.AS_STR_LIBRARY_PREFIXES = priorPrefixes;
}

process.env.AS_STR_LIBRARY_PREFIXES = "~lib/review-shadowed-library";
try {
  await checkFixture("review-shadowed-library", { run: 1 }, [
    "--path",
    `${repo}/transform/__tests__/fixtures/libraries`,
  ]);
} finally {
  if (priorPrefixes === undefined) delete process.env.AS_STR_LIBRARY_PREFIXES;
  else process.env.AS_STR_LIBRARY_PREFIXES = priorPrefixes;
}

process.env.AS_STR_LIBRARY_PREFIXES = "~lib/selected-api";
try {
  await checkFixture("review-wildcard-boundary", { run: 8 }, [
    "--path",
    `${repo}/transform/__tests__/fixtures/libraries`,
  ]);
} finally {
  if (priorPrefixes === undefined) delete process.env.AS_STR_LIBRARY_PREFIXES;
  else process.env.AS_STR_LIBRARY_PREFIXES = priorPrefixes;
}

assert.deepEqual(failures, [], failures.join("\n\n"));
console.log("remaining review regressions passed");
