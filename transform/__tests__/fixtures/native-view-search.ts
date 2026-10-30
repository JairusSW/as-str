const owners = [
  "abcdefabcdef",
  "",
  "abc",
  "😀x😀",
  "e\u0301é",
  "\ud800x\udfff",
  "bbbbbbbb",
  "終わり",
];
const needles: str[] = [
  str.from("[]").slice(1, -1),
  str.from("[bcd]").slice(1, -1),
  str.from("[c]").slice(1, -1),
  str.from("[😀]").slice(1, -1),
  str.from("[e\u0301]").slice(1, -1),
  str.from("[\ud800]").slice(1, -1),
  str.from("[\udfff]").slice(1, -1),
  str.from("[z]").slice(1, -1),
];
export function search(
  owner: string,
  needle: str,
  position: i32,
  operation: i32,
): i32 {
  if (isDefined(AS_STR_NATIVE_BASELINE)) {
    const value = needle.toString();
    switch (operation) {
      case 0:
        return owner.indexOf(value, position);
      case 1:
        return owner.lastIndexOf(value, position);
      case 2:
        return owner.includes(value, position) ? 1 : 0;
      case 3:
        return owner.startsWith(value, position) ? 1 : 0;
      case 4:
        return owner.endsWith(value, position) ? 1 : 0;
      case 5:
        return owner.localeCompare(value);
    }
  } else {
    switch (operation) {
      case 0:
        return owner.indexOf(needle, position);
      case 1:
        return owner.lastIndexOf(needle, position);
      case 2:
        return owner.includes(needle, position) ? 1 : 0;
      case 3:
        return owner.startsWith(needle, position) ? 1 : 0;
      case 4:
        return owner.endsWith(needle, position) ? 1 : 0;
      case 5:
        return owner.localeCompare(needle);
    }
  }
  return -999;
}
export function query(
  owner: i32,
  needle: i32,
  position: i32,
  operation: i32,
): i32 {
  return search(owners[owner], needles[needle], position, operation);
}
export function allocations(): i32 {
  let result = 0;
  for (let operation = 0; operation < 5; operation++)
    result += search(
      owners[0],
      needles[1],
      operation === 1
        ? i32.MAX_VALUE
        : operation === 3
          ? 1
          : operation === 4
            ? 4
            : 0,
      operation,
    );
  return result;
}
let state = 0;
let mutable = "abcdef";
function owner(): string {
  state = state * 10 + 1;
  return mutable;
}
function needle(): str {
  state = state * 10 + 2;
  mutable = "xxx";
  return needles[1];
}
function position(): i32 {
  state = state * 10 + 3;
  return 0;
}
export function effects(): i32 {
  mutable = "abcdef";
  state = 0;
  let result: i32;
  if (isDefined(AS_STR_NATIVE_BASELINE))
    result = owner().indexOf(needle().toString(), position());
  else result = owner().indexOf(needle(), position());
  return result * 1000 + state;
}
function packed(input: string, position: i32): bool {
  const part = input.slice(1, 5);
  return part.includes("c", position);
}
export function positionedPacked(position: i32): i32 {
  return packed("abcdef", position) ? 1 : 0;
}
export function positionedView(position: i32): i32 {
  // @as-str prefer-view
  const part = "bcde";
  return part.includes("c", position) ? 1 : 0;
}

export function orderingAllocations(): i32 {
  return search(owners[0], needles[1], 0, 5);
}
export function orderingEffects(): i32 {
  mutable = "abcdef";
  state = 0;
  let result: i32;
  if (isDefined(AS_STR_NATIVE_BASELINE))
    result = owner().localeCompare(needle().toString());
  else result = owner().localeCompare(needle());
  return result * 1000 + state;
}
export function orderingPacked(): i32 {
  return owners[0].slice(1, 5).localeCompare("bcde");
}
export function orderingView(): i32 {
  // @as-str prefer-view
  const part = "abc";
  return part.localeCompare("abd");
}
