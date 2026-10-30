function recursiveLength(value: string, depth: i32): i32 {
  if (depth <= 0) return value.length;
  return recursiveLength(value.slice(1).trim(), depth - 1);
}

export function asciiPipeline(): i32 {
  const value = "  alpha/beta/gamma  ".trim();
  const middle = value.slice(6, 10).substring(0, 4);
  return middle.length + middle.charCodeAt(0);
}

export function unicodePipeline(): i32 {
  const value = "  Καλημέρα世界  ".trim();
  return value.slice(2, -1).length + value.charAt(0).length;
}

export function branchPipeline(choose: bool): i32 {
  let value = "abcdef".slice(1, 5);
  if (choose) value = "uvwxyz".substring(2, 6);
  return value.length + value.charCodeAt(0);
}

export function recursivePipeline(): i32 {
  return recursiveLength("  abcdef  ", 3);
}

export function boundsPipeline(): i32 {
  const left = "abcdef".slice(-20, 2);
  const right = "abcdef".substring(5, 2);
  return left.length * 10 + right.length;
}

export function scalarLengthPipeline(): i32 {
  const input = "  abc/def=ghi[jkl]<mno>  ";
  const sliced = input.slice(-8, -1);
  const substring = input.substring(9, 2);
  const substr = input.substr(-8, 4);
  const trimmed = input.trim();
  const trimStart = input.trimStart();
  const trimEnd = input.trimEnd();
  const char = input.charAt(2);
  const at = input.at(-1);
  return (
    sliced.length +
    substring.length +
    substr.length +
    trimmed.length +
    trimStart.length +
    trimEnd.length +
    char.length +
    at.length
  );
}

export function scalarSpanPipeline(): i32 {
  const input = "  abcdef  ";
  const left = input.substr(1, 8);
  const leftTrimmed = left.trimStart();
  const right = input.trimEnd();
  const rightSliced = right.slice(2, -1);
  return (
    left.length * 1000 +
    leftTrimmed.length * 100 +
    right.length * 10 +
    rightSliced.length
  );
}

function asciiLowerMatch(value: string): bool {
  value = value.toLowerCase();
  return value === "abc";
}

export function packedCaseFoldPipeline(): i32 {
  let result = 0;
  if (asciiLowerMatch("xABCy".slice(1, 4))) result |= 1;
  if (asciiLowerMatch("xAbDy".slice(1, 4))) result |= 2;
  if (asciiLowerMatch("xäBCy".slice(1, 4))) result |= 4;
  if (asciiLowerMatch("xabcY".slice(1, 4))) result |= 8;
  return result;
}

function lowerUppercaseLiteral(value: string): bool {
  value = value.toLowerCase();
  return value === "ABC";
}

function lowerUnicode(value: string): bool {
  value = value.toLowerCase();
  return value === "ä";
}

function lowerConditionally(value: string, lower: bool): bool {
  if (lower) value = value.toLowerCase();
  return value === "abc";
}

function lowerScalar(value: string): i32 {
  value = value.toLowerCase();
  return value.charCodeAt(0) + (value.startsWith("a") ? 1000 : 0);
}

function compareBeforeLower(value: string, other: string): bool {
  const same = value === other;
  value = value.toLowerCase();
  return same && value === "abc";
}

export function uppercaseLiteralPipeline(): bool {
  return lowerUppercaseLiteral("xABCy".slice(1, 4));
}

export function unicodeLowercasePipeline(): bool {
  return lowerUnicode("xÄy".slice(1, 2));
}

export function conditionalLowercasePipeline(lower: bool): bool {
  return lowerConditionally("xABCy".slice(1, 4), lower);
}

export function lowercaseScalarPipeline(): i32 {
  return lowerScalar("xABCy".slice(1, 4));
}

export function comparisonBeforeLowercasePipeline(): bool {
  return compareBeforeLower("xABCy".slice(1, 4), "abc");
}

export function twoSpansPipeline(equal: bool): i32 {
  const source = equal ? "abcabc" : "abcxyz";
  const left = source.slice(0, 3);
  const right = source.slice(3, 6);
  let result = 0;
  if (left === right) result |= 1;
  if (left == right) result |= 2;
  if (left !== right) result |= 4;
  if (left != right) result |= 8;
  if (source.slice(0, 3) === right) result |= 16;
  if (left !== source.slice(3, 6)) result |= 32;
  return result;
}

function lowerExpanded(value: string): bool {
  value = value.toLowerCase();
  return value === "i\u0307";
}

function lowerInequality(value: string): bool {
  value = value.toLowerCase();
  return "ABC" !== value && value != "abd" && "abc" == value;
}

function lowerLength(value: string): i32 {
  value = value.toLowerCase();
  return value.length;
}

export function unicodeExpansionPipeline(): i32 {
  return (
    (lowerExpanded("xİy".slice(1, 2)) ? 100 : 0) +
    lowerLength("xİy".slice(1, 2))
  );
}

export function lowercaseInequalityPipeline(): bool {
  return lowerInequality("xABCy".slice(1, 4));
}

export function splitLimitPipeline(limit: i32): i32 {
  const value = " a,b,,c, ".trim();
  const parts = value.split(",", limit);
  let score = parts.length;
  for (let i = 0; i < parts.length; i++) score += parts[i].length;
  return score;
}

let evaluationCounter: i32 = 0;
function orderedValue(): string {
  evaluationCounter++;
  return evaluationCounter == 1 ? "abcX" : "abc";
}

function orderedEnd(): i32 {
  evaluationCounter++;
  return 3;
}

export function equalityEvaluationOrder(variant: i32): i32 {
  evaluationCounter = 0;
  const source = "abcX";
  let same = false;
  if (variant == 0) same = orderedValue() == source.slice(0, orderedEnd());
  if (variant == 1) same = orderedValue() === source.slice(0, orderedEnd());
  if (variant == 2) same = orderedValue() != source.slice(0, orderedEnd());
  if (variant == 3) same = orderedValue() !== source.slice(0, orderedEnd());
  if (variant == 4) same = source.slice(0, orderedEnd()) == orderedValue();
  if (variant == 5) same = source.slice(0, orderedEnd()) === orderedValue();
  if (variant == 6) same = source.slice(0, orderedEnd()) != orderedValue();
  if (variant == 7) same = source.slice(0, orderedEnd()) !== orderedValue();
  return (same ? 100 : 0) + evaluationCounter;
}

class GetterSource {
  reads: i32 = 0;
  get text(): string {
    this.reads++;
    return this.reads == 1 ? "abcX" : "xyz";
  }
}

export function getterEqualityEvaluation(variant: i32): i32 {
  const source = new GetterSource();
  let same = false;
  if (variant == 0) same = source.text.slice(0, 3) == "abc";
  if (variant == 1) same = source.text.slice(0, 3) !== "abc";
  if (variant == 2) same = "abc" === source.text.slice(0, 3);
  if (variant == 3) same = "abc" != source.text.slice(0, 3);
  return (same ? 100 : 0) + source.reads;
}

function packedGetterMatch(value: string): bool {
  return value == "abc";
}

export function getterPackedArgument(): i32 {
  const source = new GetterSource();
  const same = packedGetterMatch(source.text.slice(0, 3));
  return (same ? 100 : 0) + source.reads;
}

export function callPackedArgument(): i32 {
  evaluationCounter = 0;
  const same = packedGetterMatch(orderedValue().slice(0, 3));
  return (same ? 100 : 0) + evaluationCounter;
}

function packedInitMatch(value: string): bool {
  return value == "abc";
}
const initializedPacked = packedInitMatch("abcX".slice(0, 3));
export function initializedPackedArgument(): bool {
  return initializedPacked;
}

function packedNestedMatch(value: string): bool {
  return packedGetterMatch(value.slice(0, 3));
}
export function nestedPackedArgument(): bool {
  const sliced = " abcX ".trim();
  return packedNestedMatch(sliced.slice(0, 4));
}

let mutablePackedSource: string = "";
function mutatePackedSource(): i32 {
  mutablePackedSource = "changed";
  __collect();
  const replacements = new Array<string>();
  for (let i = 0; i < 64; i++) {
    replacements.push(String.fromCharCodes([120, 121, 122, i + 32]));
  }
  return replacements.length == 64 ? 3 : 0;
}
export function mutatedPackedArgument(): bool {
  mutablePackedSource = String.fromCharCodes([97, 98, 99, 88]);
  return packedGetterMatch(mutablePackedSource.slice(0, mutatePackedSource()));
}

class CustomSlicer {
  toLowerCase(): CustomSlicer {
    return this;
  }
  slice(start: i32, end: i32): string {
    return start == 0 && end == 3 ? "abc" : "other";
  }
}
export function customMethodEquality(): bool {
  const source = new CustomSlicer();
  return source.slice(0, 3) == "abc";
}

function customSliceMatch(value: string): bool {
  return value == "abc";
}
export function customMethodArgument(): bool {
  const source = new CustomSlicer();
  return customSliceMatch(source.slice(0, 3));
}
export function customMethodLength(): i32 {
  const source = new CustomSlicer();
  const value = source.slice(0, 3);
  return value.length;
}

export function customMethodChain(): i32 {
  const source = new CustomSlicer();
  return source.toLowerCase().slice(0, 3).length;
}

const globalStringSource: string = "abcX";
function packedGlobalMatch(value: string): bool {
  return value == "abc";
}
export function globalStringArgument(): bool {
  return packedGlobalMatch(globalStringSource.slice(0, 3));
}
export function shadowedGlobalString(): bool {
  const globalStringSource = new CustomSlicer();
  return globalStringSource.slice(0, 3) == "abc";
}

class StringFieldHolder {
  payload: string = "abcX";
}
class ObjectFieldHolder {
  payload: CustomSlicer = new CustomSlicer();
}
export function collidingFieldTypes(): i32 {
  const object = new ObjectFieldHolder();
  const text = new StringFieldHolder();
  return object.payload.slice(0, 3).length + text.payload.slice(0, 3).length;
}

class StaticFieldHolder {
  static payload: string = "abcX";
}
export function staticFieldReceiver(): i32 {
  return StaticFieldHolder.payload.slice(0, 3).length;
}

export function duplicatePrimitiveNames(): i32 {
  let score = 0;
  {
    const value = new CustomSlicer();
    if (value.slice(0, 3) == "abc") score += 1;
  }
  {
    const value: string = "abcd";
    if (value.slice(0, 3) == "abc") score += 2;
  }
  return score;
}

function parameterShadow(value: string): i32 {
  let score = 0;
  {
    const value = new CustomSlicer();
    if (value.slice(0, 3) == "abc") score += 1;
  }
  if (value.slice(0, 3) == "abc") score += 2;
  return score;
}
export function parameterShadowNames(): i32 {
  return parameterShadow("abcX");
}
export function duplicateExplicitViews(): i32 {
  let score = 0;
  {
    const value: str = str.from("abc");
    score += value.at(99).length;
  }
  {
    const value: string = "abcd";
    score += value.slice(0, 2).length;
  }
  return score;
}

class LocalLength {
  length: i32 = 17;
}
function shadowPackedLength(value: string): i32 {
  let score = value.length;
  {
    const value = new LocalLength();
    score += value.length;
  }
  return score;
}
export function packedParameterShadow(): i32 {
  return shadowPackedLength("xabc".slice(1));
}

class LocalSearch {
  indexOf(search: string): i32 {
    return search.length == 1 ? 17 : -1;
  }
}
function shadowPackedSearch(value: string): i32 {
  let score = value.indexOf("a");
  {
    const value = new LocalSearch();
    score += value.indexOf("a");
  }
  return score;
}
export function packedSearchShadow(): i32 {
  return shadowPackedSearch("xabc".slice(1));
}
function shadowFoldedValue(value: string): i32 {
  value = value.toLowerCase();
  let score = value == "abc" ? 1 : 0;
  {
    let value: string = "XYZ";
    value = value.toLowerCase();
    if (value == "xyz") score += 2;
  }
  return score;
}
export function packedLowercaseShadow(): i32 {
  return shadowFoldedValue("xABC".slice(1));
}

function collidingPackedOwner(value: string, __as_str_owner_value: i32): i32 {
  return value.length + __as_str_owner_value;
}
export function packedOwnerParameterCollision(): i32 {
  return collidingPackedOwner("xabc".slice(1), 17);
}

function collidingPackedOwnerLocal(value: string): i32 {
  const __as_str_owner_value = 17;
  return value.length + __as_str_owner_value;
}
export function packedOwnerLocalCollision(): i32 {
  return collidingPackedOwnerLocal("xabc".slice(1));
}

const __as_str_owner_text = 23;
function collidingPackedOwnerGlobal(text: string): i32 {
  return text.length + __as_str_owner_text;
}
export function packedOwnerGlobalCollision(): i32 {
  return collidingPackedOwnerGlobal("xabc".slice(1));
}

export function explicitCopyBacking(): i32 {
  const source = "abc";
  const view: str = str.from(source).slice(1);
  const copy: str = str.from(view.toString());
  return copy.data.length;
}

export function explicitCopyViewMutation(): i32 {
  const existing: str = str.from("abc");
  const copy: str = str.from(existing.toString());
  copy.start += 2;
  return existing.length * 10 + copy.length;
}

function collidingPackedOwners(value: string, value_: string): i32 {
  const __as_str_owner_value = 7;
  const __as_str_owner_value_ = 11;
  return (
    value.length * 100 +
    value_.length * 10 +
    __as_str_owner_value +
    __as_str_owner_value_
  );
}
export function packedOwnerPlanCollision(): i32 {
  return collidingPackedOwners("xabc".slice(1), "xyab".slice(2));
}

function mutableAliasTarget(value: string): i32 {
  return value.length;
}
function mutableAliasReplacement(value: string): i32 {
  return value.length + 100;
}
export function mutableFunctionAlias(): i32 {
  let callback = mutableAliasTarget;
  const initial = callback("ab");
  callback = mutableAliasReplacement;
  return initial + callback("xabc".slice(1));
}

function shadowedCallbackName(value: string): i32 {
  return value.length;
}
export function realFunctionCall(): i32 {
  return shadowedCallbackName("xabc".slice(1));
}
export function shadowedFunctionCall(): i32 {
  const shadowedCallbackName = (value: string): i32 => value.length + 100;
  return shadowedCallbackName("xabc".slice(1));
}

function invokeShadowedCallback(
  shadowedCallbackName: (value: string) => i32,
): i32 {
  return shadowedCallbackName("xabc".slice(1));
}
export function functionParameterShadow(): i32 {
  return invokeShadowedCallback((value: string): i32 => value.length + 200);
}

function aliasedViewLength(value: str): i32 {
  return value.length;
}
function aliasedNativeLength(value: string): i32 {
  return value.length + 100;
}
export function blockScopedCallbacks(): i32 {
  let score = 0;
  {
    const scopedCallback = aliasedViewLength;
    score += scopedCallback(str.from("abc"));
  }
  {
    const scopedCallback = aliasedNativeLength;
    score += scopedCallback("abcd");
  }
  return score;
}
