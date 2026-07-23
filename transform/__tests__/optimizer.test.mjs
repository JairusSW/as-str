import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileFixture, functionBody, instantiate, repo } from "./harness.mjs";
const operations = await import(
  pathToFileURL(path.join(repo, "transform/lib/operations.js"))
);

const strSource = readFileSync(path.join(repo, "assembly/str.ts"), "utf8");
const instanceSection = strSource.slice(
  strSource.indexOf("@final export class Str"),
  strSource.indexOf("  static slice<T>"),
);
const instanceMethods = [
  ...instanceSection.matchAll(
    /^ {2}(?!static\b)(?:get )?([A-Za-z_][A-Za-z0-9_]*)(?:<[^\n]+?>)?\([^\n]*$/gm,
  ),
]
  .map((match) => match[1])
  .filter((name) => name !== "constructor");
for (const method of instanceMethods) {
  assert.equal(
    operations.operationSemantics(method).result !== "unknown",
    true,
    `Str instance method is missing from transform semantics: ${method}`,
  );
}
assert.deepEqual(operations.operationSemantics("slice"), {
  result: "view",
  lengthFusible: true,
  spanProducing: true,
  spanScalar: false,
  container: false,
  normalizedSpanName: "slice",
});
assert.equal(operations.operationSemantics("indexOf").spanScalar, true);
assert.equal(operations.operationSemantics("concat").result, "native");
assert.equal(operations.operationSemantics("split").container, true);
assert.equal(
  operations.operationSemantics("notAStringOperation").result,
  "unknown",
);

const local = compileFixture("local-promotion", {
  extra: ["--exportRuntime"],
});
assert.match(local.output, /part -> view: view-producing local/);
assert.match(
  local.output,
  /part -> native: raw-memory or representation intrinsic/,
);
assert.match(
  local.output,
  /inject \{ str \}/,
  "generated view use must auto-import str",
);
assert.match(
  local.output,
  /value -> view: closed-world parameter with profitable view operations/,
);
assert.match(
  local.output,
  /internalSliceReturn return -> view: closed-world return with profitable view result/,
);
assert.match(
  local.output,
  /preferred -> view: promoted by @as-str prefer-view/,
);
assert.match(local.output, /native -> native: @as-str no-view/);

const promoted = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/promotedLength",
);
assert.match(promoted, /\$assembly\/str\/Str\.slice/);
assert.doesNotMatch(promoted, /call \$~lib\/string\/String#slice/);
assert.doesNotMatch(promoted, /call \$assembly\/str\/Str#constructor/);

const promotedAnnotated = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/promotedAnnotatedLength",
);
assert.doesNotMatch(promotedAnnotated, /call \$~lib\/string\/String#slice/);

const promotedEquality = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/promotedEquality",
);
assert.match(promotedEquality, /Str\.(?:notEqualsSpan|equalsSpan)/);
assert.doesNotMatch(promotedEquality, /call \$~lib\/string\/String#slice/);
assert.doesNotMatch(promotedEquality, /call \$assembly\/str\/Str#constructor/);

const directEquality = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/directEquality",
);
assert.match(directEquality, /Str\.equalsSpan/);
assert.doesNotMatch(directEquality, /call \$~lib\/string\/String#slice/);

const unsafe = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/unsafePointer",
);
assert.match(unsafe, /call \$~lib\/string\/String#slice/);

const conversions = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/explicitConversions",
);
assert.match(conversions, /call \$assembly\/str\/Str\.from/);
assert.match(conversions, /call \$assembly\/str\/Str#toString/);

const callConversion = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/nativeToViewCall",
);
assert.match(callConversion, /call \$assembly\/str\/Str\.from/);

const promotedParameter = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/promotedParameter",
);
assert.match(promotedParameter, /call \$assembly\/str\/Str\.from/);
const internalSlice = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/internalSliceLength",
);
assert.doesNotMatch(internalSlice, /call \$~lib\/string\/String#slice/);

const branchAlias = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/branchAndAlias",
);
assert.match(branchAlias, /\$assembly\/str\/Str\.slice/);
assert.doesNotMatch(
  branchAlias,
  /call \$~lib\/string\/String#(?:slice|substring)/,
);

const recursiveEntry = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/recursiveParameter",
);
assert.match(recursiveEntry, /call \$assembly\/str\/Str\.from/);
const recursiveBody = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/recursiveSlice",
);
assert.doesNotMatch(recursiveBody, /call \$~lib\/string\/String#slice/);

const promotedReturn = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/promotedReturn",
);
assert.doesNotMatch(promotedReturn, /call \$assembly\/str\/Str#toString/);
const internalReturn = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/internalSliceReturn",
);
assert.doesNotMatch(internalReturn, /call \$~lib\/string\/String#slice/);

const directTemporary = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/directTemporary",
);
assert.doesNotMatch(directTemporary, /call \$~lib\/string\/String#slice/);
assert.match(directTemporary, /\$assembly\/str\/Str\.sliceLength/);
assert.doesNotMatch(directTemporary, /call \$assembly\/str\/Str#constructor/);
const loopReassignment = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/loopReassignment",
);
assert.doesNotMatch(loopReassignment, /call \$~lib\/string\/String#slice/);
assert.match(loopReassignment, /\$assembly\/str\/Str(?:\.slice|#trim)/);

const fieldElements = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/fieldAndElementConversions",
);
assert.match(fieldElements, /call \$assembly\/str\/Str\.from/);
assert.match(fieldElements, /call \$assembly\/str\/Str#toString/);
const fieldSetter = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/InteropFields#assignBoth",
);
assert.match(fieldSetter, /call \$assembly\/str\/Str\.from/);
assert.match(fieldSetter, /call \$assembly\/str\/Str#toString/);

const roundTrips = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/redundantRoundTrips",
);
assert.doesNotMatch(roundTrips, /call \$assembly\/str\/Str#toString/);
assert.equal(
  (roundTrips.match(/call \$assembly\/str\/Str\.from/g) ?? []).length,
  1,
  "only the one required native-to-view conversion should remain",
);
const typedContainers = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/typedContainerMethods",
);
assert.match(typedContainers, /call \$assembly\/str\/Str\.from/);
assert.match(typedContainers, /call \$assembly\/str\/Str#toString/);
const provenNullable = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/provenNullable",
);
assert.match(provenNullable, /\$assembly\/str\/Str\.slice/);
assert.doesNotMatch(provenNullable, /call \$~lib\/string\/String#slice/);

const scalarSpanConsumers = functionBody(
  local.wat,
  "transform/__tests__/fixtures/local-promotion/scalarSpanConsumers",
);
assert.doesNotMatch(
  scalarSpanConsumers,
  /call \$~lib\/string\/String#substring/,
);
assert.doesNotMatch(
  scalarSpanConsumers,
  /call \$assembly\/str\/Str#constructor/,
);
assert.match(
  local.output,
  /scalarized non-escaping view into a packed pointer span/,
);

const single = compileFixture("local-promotion", { mode: "single" });
const singleScalarSpanConsumers = functionBody(
  single.wat,
  "transform/__tests__/fixtures/local-promotion/scalarSpanConsumers",
);
assert.doesNotMatch(
  singleScalarSpanConsumers,
  /call \$assembly\/str\/Str#constructor/,
);
assert.match(
  single.output,
  /scalarized non-escaping view into a packed pointer span/,
);
assert.doesNotMatch(
  single.output,
  /closed-world (?:parameter|return)/,
  "single-pass mode must not promote function boundaries without semantic facts",
);

const instantiated = await instantiate(local.wasm);
assert.equal(instantiated.instance.exports.semanticCheck(), 103);
assert.equal(instantiated.instance.exports.globalAndFieldInitializers(), 22);
assert.equal(instantiated.instance.exports.evaluationOrder(), 123);
assert.equal(instantiated.instance.exports.scalarSpanSemanticCheck(), 205);

const auto = compileFixture("generic-conflict");
assert.match(auto.output, /semantic analysis: \d+ facts/);
assert.match(
  auto.output,
  /identity return -> unknown: tracked resolved conflicting generic instantiations/,
);
const autoModule = await instantiate(auto.wasm);
assert.equal(autoModule.instance.exports.stringInstantiation(), 5);
assert.equal(autoModule.instance.exports.numberInstantiation(7), 7);

const noOp = compileFixture("no-op");
assert.doesNotMatch(
  noOp.output,
  /inject \{ str \}/,
  "a source with only rejected promotions must not import the view runtime",
);
const barriers = compileFixture("safety-barriers");
assert.match(barriers.output, /native string function parameter/);
assert.match(barriers.output, /explicit cast or assertion/);
assert.match(barriers.output, /raw-memory or representation intrinsic/);
assert.match(barriers.output, /unknown or external call/);
assert.match(barriers.output, /operator use/);
assert.match(barriers.output, /unsupported or escaping use/);
assert.match(barriers.output, /derived view assigned to native string/);
assert.match(
  barriers.output,
  /derived view passed to unknown or external call/,
);
assert.match(barriers.output, /derived view used by operator/);
assert.doesNotMatch(
  barriers.output,
  /path -> view: closed-world parameter/,
  "methods implementing native-string interfaces must retain their ABI",
);
assert.match(
  barriers.output,
  /preferred -> native: raw-memory or representation intrinsic/,
  "prefer-view must never override an unsafe native-representation use",
);

for (const name of [
  "nativeCall",
  "explicitCast",
  "rawStore",
  "genericBoundary",
  "containerBoundary",
  "fieldBoundary",
  "nullableBoundary",
  "templateBoundary",
  "concatBoundary",
  "preferredUnsafe",
  "derivedAssignment",
  "derivedExternalCall",
  "derivedOperator",
]) {
  const body = functionBody(
    barriers.wat,
    `transform/__tests__/fixtures/safety-barriers/${name}`,
  );
  assert.match(body, /call \$~lib\/string\/String#slice/);
  assert.doesNotMatch(body, /\$assembly\/str\/Str\.slice/);
}

const derivedParameter = functionBody(
  barriers.wat,
  "transform/__tests__/fixtures/safety-barriers/derivedParameter",
);
assert.match(derivedParameter, /call \$~lib\/string\/String#substring/);
assert.doesNotMatch(derivedParameter, /\$assembly\/str\/Str\.substring/);

const crossModule = compileFixture("cross-module");
const convertedCrossCall = functionBody(
  crossModule.wat,
  "transform/__tests__/fixtures/cross-module/convertedCall",
);
assert.match(convertedCrossCall, /call \$assembly\/str\/Str\.from/);
const nativeCrossBarrier = functionBody(
  crossModule.wat,
  "transform/__tests__/fixtures/cross-module/nativeBarrier",
);
assert.match(nativeCrossBarrier, /call \$~lib\/string\/String#slice/);
assert.doesNotMatch(nativeCrossBarrier, /\$assembly\/str\/Str\.slice/);
const packedSpanCall = functionBody(
  crossModule.wat,
  "transform/__tests__/fixtures/cross-module/packedSpanCall",
);
assert.doesNotMatch(packedSpanCall, /call \$~lib\/string\/String#slice/);
assert.doesNotMatch(packedSpanCall, /call \$assembly\/str\/Str#constructor/);
const packedLowerCall = functionBody(
  crossModule.wat,
  "transform/__tests__/fixtures/cross-module/packedLowerCall",
);
assert.doesNotMatch(packedLowerCall, /call \$~lib\/string\/String#slice/);
assert.doesNotMatch(packedLowerCall, /call \$~lib\/string\/String#toLowerCase/);

const knownCalls = compileFixture("known-calls");
for (const name of ["knownCallback", "knownMethod"]) {
  const body = functionBody(
    knownCalls.wat,
    `transform/__tests__/fixtures/known-calls/${name}`,
  );
  assert.match(body, /\$assembly\/str\/Str\.(?:from|slice|substring)/);
  assert.doesNotMatch(body, /call \$~lib\/string\/String#(?:slice|substring)/);
}

const viewOperations = compileFixture("view-operations");
const allViewOperations = functionBody(
  viewOperations.wat,
  "transform/__tests__/fixtures/view-operations/allViewOperations",
);
for (const method of [
  "slice",
  "substring",
  "substr",
  "trim",
  "trimStart",
  "trimEnd",
  "trimLeft",
  "trimRight",
  "charAt",
  "at",
  "before",
  "after",
  "between",
  "beforeLast",
  "afterLast",
  "betweenLast",
]) {
  assert.match(
    allViewOperations,
    new RegExp(`assembly\\/str\\/Str\\.${method}Length<`),
    `missing allocation-free ${method} length specialization`,
  );
}
assert.doesNotMatch(allViewOperations, /call \$assembly\/str\/Str#constructor/);
assert.doesNotMatch(
  allViewOperations,
  /call \$~lib\/string\/String#(?:slice|substring|substr|trim|trimStart|trimEnd|charAt)/,
);

const branchEnabled = compileFixture("branch-only");
const branchDisabled = compileFixture("branch-only", {
  mode: "global",
  suffix: "disabled",
  debug: true,
});
const disabledWat = branchDisabled.wat;
assert.match(disabledWat, /call \$~lib\/string\/String#slice/);
assert.doesNotMatch(disabledWat, /assembly\/str\/Str\.slice/);
const enabledBranchModule = await instantiate(branchEnabled.wasm);
const disabledBranchModule = await instantiate(branchDisabled.wasm);
for (const choose of [0, 1]) {
  assert.equal(
    enabledBranchModule.instance.exports.observable(choose),
    disabledBranchModule.instance.exports.observable(choose),
    "optimized and unoptimized observable behavior must match",
  );
}

console.log("transform optimizer fixtures passed");
