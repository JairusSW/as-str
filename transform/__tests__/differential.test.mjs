import assert from "node:assert/strict";
import { compileFixture, instantiate } from "./harness.mjs";

const cases = [
  ["functionParameterShadow", [[]]],
  ["blockScopedCallbacks", [[]]],
  ["shadowedFunctionCall", [[]]],
  ["realFunctionCall", [[]]],
  ["mutableFunctionAlias", [[]]],
  ["packedOwnerPlanCollision", [[]]],
  ["explicitCopyViewMutation", [[]]],
  ["explicitCopyBacking", [[]]],
  ["packedOwnerGlobalCollision", [[]]],
  ["packedOwnerParameterCollision", [[]]],
  ["packedOwnerLocalCollision", [[]]],
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
        "shadowedCallbackName",
        "collidingPackedOwners",
        "collidingPackedOwner",
        "collidingPackedOwnerLocal",
        "collidingPackedOwnerGlobal",
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
  const nullableBaseline = compileFixture("nullable-behavior", {
    mode: "global",
    suffix: `baseline-${build}`,
    extra,
  });
  const nullableNative = await instantiate(nullableBaseline.wasm);
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("nullable-behavior", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const module = await instantiate(compiled.wasm);
    if (mode === "auto" && build === "debug")
      assert.match(
        compiled.wat,
        /\(func \$transform\/__tests__\/fixtures\/nullable-behavior\/comparePackedReverse \(param \$0 i64\)/,
        "nullable comparison operands must retain packed parameter lowering",
      );
    for (const name of [
      "nullableViewAssignment",
      "nullableNativeAssignment",
      "nullableViewResult",
      "nullableGlobalAssignment",
      "nullableFieldAssignment",
      "nullableAccessorResult",
      "nullableElementAssignment",
      "nullableTernary",
      "nullableNativeSlice",
      "nullableCallback",
      "scopedNullableAssignment",
      "sliceNullableStringEquality",
      "sliceNullableStringInequality",
      "packedNullableReverse",
    ])
      for (const clear of [0, 1])
        assert.equal(
          module.instance.exports[name](clear),
          nullableNative.instance.exports[name](clear),
          `${mode}/${build}/${name}/${clear}`,
        );
    for (const name of [
      "sliceNullEquality",
      "sliceNullEqualityReverse",
      "sliceNullInequality",
    ])
      assert.equal(
        module.instance.exports[name](),
        nullableNative.instance.exports[name](),
        `${mode}/${build}/${name}`,
      );
  }
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("non-null-conversions", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const module = await instantiate(compiled.wasm);
    for (const [name, expected] of [
      ["identifierNonNullConversions", 7],
      ["fieldNonNullConversions", 7],
      ["accessorNonNullConversions", 7],
      ["elementNonNullConversions", 7],
      ["parameterNonNullConversions", 7],
      ["scopedNonNullConversions", 7],
      ["callNonNullConversions", 7],
      ["callbackNonNullConversions", 3],
      ["castConversions", 7],
      ["globalNonNullConversions", 3],
      ["getterNonNullReadOnce", 103],
      ["elementNonNullReadOnce", 103],
      ["nullableArrayNonNullConversions", 3],
      ["staticArrayNonNullConversions", 3],
      ["viewNonNullAt", 0],
    ])
      assert.equal(
        module.instance.exports[name](),
        expected,
        `${mode}/${build}/${name}`,
      );
    assert.throws(
      () => module.instance.exports.nativeNonNullAt(),
      /Index out of range/,
      `${mode}/${build}: asserted native at bounds`,
    );
    if (build === "debug")
      for (const name of ["checkedNativeNull", "checkedViewNull"]) {
        const probe = await instantiate(compiled.wasm);
        assert.throws(
          () => probe.instance.exports[name](),
          /null/i,
          `${mode}/${build}/${name}`,
        );
      }
  }
  const staticBaseline = compileFixture("static-instance", {
    mode: "global",
    suffix: `baseline-${build}`,
    extra,
  });
  const staticBaselineModule = await instantiate(staticBaseline.wasm);
  for (const mode of ["auto", "single"]) {
    const optimized = compileFixture("static-instance", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const module = await instantiate(optimized.wasm);
    for (const name of [
      "staticAccessorAt",
      "instanceAccessorAt",
      "instanceViewAccessorAt",
      "staticFieldAt",
      "instanceFieldAt",
      "instanceViewFieldAt",
    ])
      assert.equal(
        module.instance.exports[name](),
        staticBaselineModule.instance.exports[name](),
        `${mode}/${build}/${name}`,
      );
    for (const name of [
      "instanceAccessorAtInvalid",
      "staticNativeAccessorAtInvalid",
      "instanceFieldAtInvalid",
      "staticNativeFieldAtInvalid",
    ]) {
      const baselineProbe = await instantiate(staticBaseline.wasm);
      const optimizedProbe = await instantiate(optimized.wasm);
      assert.throws(
        () => baselineProbe.instance.exports[name](),
        /Index out of range/,
        `baseline/${build}/${name}`,
      );
      assert.throws(
        () => optimizedProbe.instance.exports[name](),
        /Index out of range/,
        `${mode}/${build}/${name}`,
      );
    }
  }
  for (const mode of ["auto", "single"]) {
    const callbacks = await instantiate(
      compileFixture("anonymous-callbacks", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    for (const [name, expected] of [
      ["typedArrowCallback", 6],
      ["typedNamedCallback", 8],
      ["escapedArrowCallback", 10],
    ])
      assert.equal(
        callbacks.instance.exports[name](),
        expected,
        `${mode}/${build}/${name}`,
      );
    const accessorBuild = compileFixture("accessor-fields", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const accessors = await instantiate(accessorBuild.wasm);
    for (const [name, expected] of [
      ["accessorConversions", 7],
      ["staticInstanceFieldConversions", 7],
      ["staticInstanceAccessorConversions", 7],
      ["staticInstanceMethodConversions", 7],
      ["staticInstanceObjectAccessors", 7],
      ["inheritedAccessorConversions", 5],
      ["nestedAccessorFields", 203],
      ["staticAccessorConversions", 6],
      ["setterOnlyConversions", 5],
      ["getterPackedArgument", 103],
      ["viewAccessorAt", 0],
    ])
      assert.equal(
        accessors.instance.exports[name](),
        expected,
        `${mode}/${build}/${name}`,
      );
    if (mode === "auto" && build === "debug")
      assert.match(
        accessorBuild.wat,
        /\(func \$transform\/__tests__\/fixtures\/accessor-fields\/packedAccessorLength \(param \$0 i64\)/,
        "getter-backed packed arguments should retain scalar lowering",
      );
    assert.throws(
      () => accessors.instance.exports.nativeAccessorAtInvalid(),
      /Index out of range/,
      `${mode}/${build}: native getter at bounds must still throw`,
    );
  }
  for (const mode of ["auto", "single"]) {
    const calls = await instantiate(
      compileFixture("call-signatures", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    for (const [name, expected] of [
      ["sameNamedMethods", 7],
      ["sameNamedNamespaceCalls", 7],
      ["familiarMethodSignatures", 12],
      ["inheritedMethodSignatures", 8],
      ["staticMethodSignatures", 7],
      ["unqualifiedNamespaceCalls", 7],
    ])
      assert.equal(
        calls.instance.exports[name](),
        expected,
        `${mode}/${build}/${name}`,
      );
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
