export function nullableViewAssignment(clear: bool): i32 {
  let value: str | null = str.from("abc");
  if (clear) value = null;
  return value ? value.length : 17;
}

function sliceAgainstNullable(input: string, clear: bool): i32 {
  const other: string | null = clear ? null : "bc";
  return input.slice(1) == other ? 101 : 211;
}
export function sliceNullableStringEquality(clear: bool): i32 {
  return sliceAgainstNullable("abc", clear);
}
function sliceAgainstNull(input: string): bool {
  return input.slice(100) == null;
}
export function sliceNullEquality(): bool {
  return sliceAgainstNull("abc");
}

export function nullableNativeAssignment(clear: bool): i32 {
  let value: string | null = "abc";
  if (clear) value = null;
  return value ? value.length : 17;
}
function nullableView(clear: bool): str | null {
  return clear ? null : str.from("abc");
}
export function nullableViewResult(clear: bool): i32 {
  const value = nullableView(clear);
  return value ? value.length : 17;
}
let optionalGlobal: str | null = str.from("abc");
export function nullableGlobalAssignment(clear: bool): i32 {
  optionalGlobal = str.from("abc");
  if (clear) optionalGlobal = null;
  return optionalGlobal ? optionalGlobal!.length : 17;
}
class NullableStorage {
  value: str | null = str.from("abc");
  get optional(): str | null {
    return this.value;
  }
}
export function nullableFieldAssignment(clear: bool): i32 {
  const box = new NullableStorage();
  if (clear) box.value = null;
  const value = box.value;
  return value ? value.length : 17;
}
export function nullableAccessorResult(clear: bool): i32 {
  const box = new NullableStorage();
  if (clear) box.value = null;
  const value = box.optional;
  return value ? value.length : 17;
}
export function nullableElementAssignment(clear: bool): i32 {
  const values = new Array<str | null>();
  values.push(str.from("abc"));
  if (clear) values[0] = null;
  const value = values[0];
  return value ? value.length : 17;
}
export function nullableTernary(clear: bool): i32 {
  const value: str | null = clear ? null : str.from("abc");
  return value ? value.length : 17;
}
export function nullableNativeSlice(clear: bool): i32 {
  let value: string | null = "xabc".slice(1);
  if (clear) value = null;
  return value ? value.length : 17;
}
export function nullableCallback(clear: bool): i32 {
  let callback: (() => str) | null = (): str => str.from("abc");
  if (clear) callback = null;
  return callback ? callback().length : 17;
}
export function scopedNullableAssignment(clear: bool): i32 {
  let score = 0;
  {
    let value: str | null = str.from("abc");
    if (clear) value = null;
    score += value ? value.length : 17;
  }
  {
    const value: str = str.from("wxyz");
    score += value.length;
  }
  return score;
}
function sliceAgainstNullableInequality(input: string, clear: bool): i32 {
  const other: string | null = clear ? null : "bc";
  return input.slice(1) != other ? 211 : 101;
}
export function sliceNullableStringInequality(clear: bool): i32 {
  return sliceAgainstNullableInequality("abc", clear);
}
function sliceAgainstNullReverse(input: string): bool {
  return (null as string | null) == input.slice(100);
}
export function sliceNullEqualityReverse(): bool {
  return sliceAgainstNullReverse("abc");
}
function sliceNotNull(input: string): bool {
  return input.slice(100) != null;
}
export function sliceNullInequality(): bool {
  return sliceNotNull("abc");
}

function comparePackedReverse(input: string, clear: bool): i32 {
  const other: string | null = clear ? null : "bc";
  return other == input ? 101 : 211;
}
export function packedNullableReverse(clear: bool): i32 {
  return comparePackedReverse("abc".slice(1), clear);
}
