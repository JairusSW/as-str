import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { compileFixture, instantiate, repo } from "./harness.mjs";

const expected = {
  aliasFields: 7,
  nullableAlias: 3,
  nullableAliasAssignment: 0,
  aliasReturnLength: 3,
  aliasDefault: 3,
  importedAliases: 7,
  namespaceImport: 3,
  namespaceType: 3,
  customView: 62,
  customString: 34,
  namespaceAlias: 3,
  genericShadow: 42,
  outerGenericAlias: 3,
  noViewExplicit: 0,
  noViewInferred: 0,
  callbackParameterResult: 3,
  callbackParameterArgument: 3,
  callbackFieldResult: 3,
  aliasCallback: 3,
  aliasArray: 3,
  aliasNativeArray: 3,
  nullableAliasCallback: 3,
  dependentDefault: 3,
  nullableAliasArgument: 0,
  nestedNamespaceImport: 3,
  explicitlyNativeInitializer: 3,
  viewAliasAtInvalid: 0,
};
for (const [build, extra] of [
  ["debug", []],
  ["release", ["-O3", "--noAssert", "--enable", "simd"]],
]) {
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("type-aliases", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const module = await instantiate(compiled.wasm);
    assert.throws(
      () => module.instance.exports.nativeAliasAtInvalid(),
      /abort/,
      `${mode}/${build}: native aliases retain at bounds checks`,
    );
    for (const [name, result] of Object.entries(expected)) {
      assert.equal(
        module.instance.exports[name](),
        result,
        `${mode}/${build}/${name}`,
      );
    }
  }
  for (const [fixture, cases] of [
    [
      "object-aliases",
      {
        annotatedObject: 7,
        aliasFactory: 0,
        nestedAlias: 7,
        inheritedAlias: 7,
        nullableObjectAlias: 3,
        arrayObjectAlias: 7,
        callbackObjectAlias: 3,
        namespaceObjectAlias: 7,
      },
    ],
    [
      "rest-conversions",
      {
        viewRest: 7,
        nativeRest: 7,
        genericRest: 3,
        genericRestMethods: 6,
        callbackRest: 8,
        restEvaluationOrder: 1208,
        emptyRest: 0,
      },
    ],
    [
      "generic-class-types",
      {
        mixedGenericFields: 16,
        classDefaultArguments: 7,
        classDefaultReadOnce: 103,
        importedClassDefault: 3,
        classContextDefaults: 16,
        importedGenericClass: 7,
        importedGenericFunction: 16,
        genericMethods: 16,
        genericFunctionCalls: 16,
        genericMethodShadow: 10,
        genericInheritedMethods: 3,
        nullableGenericCall: 3,
        genericAccessors: 7,
        genericInheritance: 7,
        nestedGenericFields: 3,
        genericAliasFields: 3,
        genericDefaultField: 3,
        genericNullableAssertion: 3,
        genericNullableAssignment: 17,
      },
    ],
    [
      "imported-factory-types",
      {
        renamedFactory: 7,
        namespaceFactory: 3,
        factoryReadOnce: 103,
        importedGlobalObject: 3,
        mutableFactoryCallback: 5,
      },
    ],
    [
      "imported-function-types",
      {
        renamedCalls: 7,
        importedGlobalView: 3,
        namespacedGlobalView: 3,
        collidingImportedName: 7,
        mutableImportedCallback: 32,
        namespaceCalls: 7,
        nestedNamespaceCalls: 17,
        reexportCalls: 7,
        reexportNamespaceCalls: 11,
        importedConstantAlias: 3,
        importedCallback: 3,
        localImportedAlias: 3,
      },
    ],
    [
      "imported-class-types",
      {
        importedFields: 7,
        importedStatic: 7,
        importedMethod: 3,
        importedAccessors: 7,
        importedNested: 3,
        importedInherited: 7,
        importedNamespace: 7,
        importedArray: 3,
      },
    ],
    [
      "array-boundaries",
      {
        arrayParameter: 7,
        arrayParameterAssignment: 3,
        arrayField: 3,
        arrayGlobal: 3,
        nestedArray: 3,
        arrayGetterReadOnce: 103,
        nativeArrayParameter: 3,
      },
    ],
  ]) {
    for (const mode of ["auto", "single"]) {
      const module = await instantiate(
        compileFixture(fixture, { mode, suffix: `${mode}-${build}`, extra })
          .wasm,
      );
      for (const [name, result] of Object.entries(cases))
        assert.equal(
          module.instance.exports[name](),
          result,
          `${mode}/${build}/${fixture}/${name}`,
        );
    }
  }
  const inference = await instantiate(
    compileFixture("generic-inference", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  const inferred = {
    inferredViewIdentity: 22,
    inferredDefaultInitializer: 2,
    inferredConstructorDefault: 22,
    inferredBoxIdentity: 222,
    inferredNative: 3,
    widenedInference: 3,
    inferredNullable: 17,
  };
  for (const [name, expected] of Object.entries(inferred))
    assert.equal(
      inference.instance.exports[name](),
      expected,
      `global/${build}/${name}`,
    );
  for (const mode of ["auto", "single"]) {
    const module = await instantiate(
      compileFixture("generic-inference", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    for (const [name, expected] of Object.entries(inferred))
      assert.equal(
        module.instance.exports[name](),
        expected,
        `${mode}/${build}/${name}`,
      );
  }
  const hygiene = await instantiate(
    compileFixture("view-type-hygiene", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const compiled = compileFixture("view-type-hygiene", {
      mode,
      suffix: `${mode}-${build}`,
      extra,
    });
    const module = await instantiate(compiled.wasm);
    for (const name of [
      "genericViewTypeShadow",
      "unshadowedPromotion",
      "explicitViewOutsideShadow",
    ])
      assert.equal(
        module.instance.exports[name](),
        hygiene.instance.exports[name](),
        `${mode}/${build}/${name}`,
      );
    assert.match(
      compiled.output,
      /part -> view: promoted by @as-str prefer-view/,
      "type hygiene must retain view promotion",
    );
  }
  const positions = await instantiate(
    compileFixture("array-position-arguments", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  assert.equal(positions.instance.exports.viewPositions(), 5121);
  assert.equal(positions.instance.exports.nativePositions(), 121);
  for (const mode of ["auto", "single"]) {
    const module = await instantiate(
      compileFixture("array-position-arguments", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    for (const name of ["viewPositions", "nativePositions"])
      assert.equal(
        module.instance.exports[name](),
        positions.instance.exports[name](),
        `${mode}/${build}/${name}`,
      );
  }
  for (const fixture of ["imported-helper-collision", "reexported-view-api"]) {
    const baseline = await instantiate(
      compileFixture(fixture, {
        mode: "global",
        suffix: `global-${build}`,
        extra,
      }).wasm,
    );
    for (const mode of ["auto", "single"]) {
      const compiled = compileFixture(fixture, {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      });
      const module = await instantiate(compiled.wasm);
      for (const name of fixture === "imported-helper-collision"
        ? ["native", "custom"]
        : ["native", "explicit"])
        assert.equal(
          module.instance.exports[name](),
          baseline.instance.exports[name](),
          `${mode}/${build}/${fixture}/${name}`,
        );
      if (fixture === "reexported-view-api")
        assert.doesNotMatch(
          compiled.wat,
          /call \$~lib\/string\/String#slice/,
          "real re-exported view helpers must retain native slicing optimization",
        );
    }
  }
  const baseline = await instantiate(
    compileFixture("custom-type-names", {
      mode: "global",
      suffix: `global-${build}`,
      extra,
    }).wasm,
  );
  for (const mode of ["auto", "single"]) {
    const module = await instantiate(
      compileFixture("custom-type-names", {
        mode,
        suffix: `${mode}-${build}`,
        extra,
      }).wasm,
    );
    for (const name of ["customViewName", "customStringName"]) {
      assert.equal(
        module.instance.exports[name](),
        baseline.instance.exports[name](),
        `${mode}/${build}/${name}`,
      );
    }
  }
}

for (const mode of ["auto", "single"]) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repo, "node_modules/assemblyscript/bin/asc.js"),
      path.join(repo, "transform/__tests__/fixtures/recursive-initializer.ts"),
      "--transform",
      path.join(repo, `transform/lib/${mode}.js`),
      "--noEmit",
    ],
    { cwd: repo, encoding: "utf8", timeout: 10000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERROR TS2339/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /RangeError|Maximum call stack/,
  );
}

console.log(
  "scoped aliases, nullable generics, imports, and custom String/Str identities passed",
);
