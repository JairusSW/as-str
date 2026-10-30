import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";

const cases = [
  ["packedSearchShadow", [[]]],
  ["packedLowercaseShadow", [[]]],
  ["packedParameterShadow", [[]]],
  ["parameterShadowNames", [[]]],
  ["duplicateExplicitViews", [[]]],
  ["duplicatePrimitiveNames", [[]]],
  ["staticFieldReceiver", [[]]],
  ["collidingFieldTypes", [[]]],
  ["globalStringArgument", [[]]],
  ["shadowedGlobalString", [[]]],
  ["customMethodChain", [[]]],
  ["customMethodArgument", [[]]],
  ["customMethodLength", [[]]],
  ["customMethodEquality", [[]]],
  ["initializedPackedArgument", [[]]],
  ["nestedPackedArgument", [[]]],
  ["mutatedPackedArgument", [[]]],
  ["getterPackedArgument", [[]]],
  ["callPackedArgument", [[]]],
  ["getterEqualityEvaluation", [[0], [1], [2], [3]]],
  ["equalityEvaluationOrder", Array.from({ length: 8 }, (_, i) => [i])],
  ["asciiPipeline", [[]]],
  ["unicodePipeline", [[]]],
  ["branchPipeline", [[0], [1]]],
  ["recursivePipeline", [[]]],
  ["boundsPipeline", [[]]],
  ["scalarLengthPipeline", [[]]],
  ["scalarSpanPipeline", [[]]],
  ["packedCaseFoldPipeline", [[]]],
  ["uppercaseLiteralPipeline", [[]]],
  ["unicodeLowercasePipeline", [[]]],
  ["conditionalLowercasePipeline", [[0], [1]]],
  ["lowercaseScalarPipeline", [[]]],
  ["comparisonBeforeLowercasePipeline", [[]]],
  ["twoSpansPipeline", [[0], [1]]],
  ["unicodeExpansionPipeline", [[]]],
  ["lowercaseInequalityPipeline", [[]]],
  ["splitLimitPipeline", [[-2147483648], [-1], [0], [1], [2], [2147483647]]],
];

for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  const baseline = compileFixture("differential-corpus", {
    mode: "global",
    suffix: `baseline-${build}`,
    extra,
  });
  const baselineModule = await instantiate(baseline.wasm);
  for (const mode of ["auto", "single"]) {
    const optimized = compileFixture("differential-corpus", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const optimizedModule = await instantiate(optimized.wasm);
    for (const [name, inputs] of cases) {
      for (const args of inputs) {
        assert.equal(
          optimizedModule.instance.exports[name](...args),
          baselineModule.instance.exports[name](...args),
          `${mode}/${build}: ${name} changed behavior for ${JSON.stringify(args)}`,
        );
      }
    }
    assert.match(optimized.output, /\[as-str\] summary:/);
    if (build === "debug" && mode === "auto")
      assert.match(
        optimized.wat,
        /\(func \$transform\/__tests__\/fixtures\/differential-corpus\/packedGlobalMatch \(param \$0 i64\)/,
        "typed globals must retain packed argument lowering",
      );
    if (build === "debug" && mode === "auto") {
      for (const name of [
        "shadowPackedLength",
        "shadowPackedSearch",
        "shadowFoldedValue",
      ]) {
        assert.match(
          optimized.wat,
          new RegExp(
            String.raw`\(func \$transform/__tests__/fixtures/differential-corpus/${name} \(param \$0 i64\)`,
          ),
          `${name} must retain packed lowering despite local shadows`,
        );
      }
    }
  }
  const viewBaseline = await instantiate(
    compileFixture("view-initializers", {
      mode: "global",
      suffix: `baseline-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const viewOptimized = await instantiate(
      compileFixture("view-initializers", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    for (const name of ["globalViewAt", "fieldViewAt", "localViewAt"]) {
      assert.equal(
        viewOptimized.instance.exports[name](),
        viewBaseline.instance.exports[name](),
        `${mode}/${build}/${name}: explicit view at semantics`,
      );
    }
  }
  for (const mode of ["auto", "single"]) {
    const inherited = await instantiate(
      compileFixture("inherited-fields", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    for (const [name, expected] of [
      ["inheritedFieldConversions", 6],
      ["multiLevelFieldConversions", 7],
      ["nullableFieldConversions", 5],
    ]) {
      assert.equal(
        inherited.instance.exports[name](),
        expected,
        `${mode}/${build}/${name}`,
      );
    }
  }
  for (const mode of ["auto", "single"]) {
    const namespaced = await instantiate(
      compileFixture("namespaced-fields", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    for (const [name, expected] of [
      ["namespacedFieldConversions", 7],
      ["namespacedInheritedFields", 5],
      ["namespacedParameterFields", 4],
      ["nestedNamespaceFields", 6],
      ["globalObjectFields", 3],
      ["aliasedObjectFields", 4],
      ["globalAliasShadowing", 7],
      ["namespacedGlobalFields", 6],
      ["namespaceShadowFields", 3],
      ["factoryObjectFields", 5],
      ["directFactoryFields", 0],
      ["methodFactoryFields", 7],
      ["callbackFactoryFields", 6],
      ["lexicalFactoryShadowing", 3],
      ["nestedObjectFields", 5],
      ["nestedInheritedFields", 6],
      ["callbackExpressionFields", 7],
      ["blockFactoryShadowing", 7],
      ["blockCallbackShadowing", 7],
    ])
      assert.equal(
        namespaced.instance.exports[name](),
        expected,
        `${mode}/${build}/${name}`,
      );
  }
  for (const mode of ["auto", "single"]) {
    const scoped = await instantiate(
      compileFixture("scoped-bindings", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    assert.equal(
      scoped.instance.exports.scopedAssignmentConversions(),
      9,
      `${mode}/${build}: scoped assignment conversions`,
    );
  }
}

console.log("transform differential corpus passed");
