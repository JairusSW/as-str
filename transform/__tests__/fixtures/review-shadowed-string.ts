import { Text } from "./review-shadowed-import-types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the alias intentionally shadows generated owner annotations.
type string = i32;

function measure(value: Text): i32 {
  return value.length;
}

export function run(): i32 {
  return measure("abcdef".slice(1));
}
