const inputs = ["[]", "[a]", "[abcd]", "[😀é]"];
const pads = ["", " ", "ab", "😀"];
export function query(
  input: i32,
  pad: i32,
  count: i32,
  operation: i32,
): string {
  const source: string = inputs[input];
  // @as-str prefer-view
  const value = source.slice(1, -1);
  if (operation == 5) return value.repeat();
  if (operation == 0) return value.repeat(count);
  if (operation == 1) return value.padStart(count, pads[pad]);
  if (operation == 2) return value.padEnd(count, pads[pad]);
  if (operation == 3) return value.padStart(count);
  return value.padEnd(count);
}
export function explicit(
  input: i32,
  pad: i32,
  count: i32,
  operation: i32,
): string {
  const value = str.from(inputs[input]).slice(1, -1);
  if (operation == 5) return value.repeat();
  if (operation == 0) return value.repeat(count);
  if (operation == 1) return value.padStart(count, pads[pad]);
  if (operation == 2) return value.padEnd(count, pads[pad]);
  if (operation == 3) return value.padStart(count);
  return value.padEnd(count);
}
let order = 0;
function source(): string {
  order = order * 10 + 1;
  return "[abcd]";
}
function length(valid: bool): i32 {
  order = order * 10 + 2;
  return valid ? 6 : -1;
}
function padding(): string {
  order = order * 10 + 3;
  return "x";
}
export function effects(valid: bool, repeat: bool): string {
  order = 0;
  // @as-str prefer-view
  const value = source().slice(1, -1);
  return repeat
    ? value.repeat(length(valid))
    : value.padEnd(length(valid), padding());
}
export function getOrder(): i32 {
  return order;
}
