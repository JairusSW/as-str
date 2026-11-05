import { str, str8 } from "../../../assembly/index";
function equal16(a: str | null, b: str | null): bool {
  return a === b;
}
function unequal16(a: str | null, b: str | null): bool {
  return a !== b;
}
function equal8(a: str8 | null, b: str8 | null): bool {
  return a === b;
}
function unequal8(a: str8 | null, b: str8 | null): bool {
  return a !== b;
}
export function run(): i32 {
  const a = str.from("abc");
  const b = str.from("abc");
  const c = str.from("def");
  const x = str8.from("abc");
  const y = str8.from("abc");
  const z = str8.from("def");
  assert(equal16(null, null) && !unequal16(null, null));
  assert(!equal16(a, null) && !equal16(null, a));
  assert(unequal16(a, null) && unequal16(null, a));
  assert(equal16(a, b) && !unequal16(a, b) && unequal16(a, c));
  assert(equal8(null, null) && !unequal8(null, null));
  assert(!equal8(x, null) && !equal8(null, x));
  assert(unequal8(x, null) && unequal8(null, x));
  assert(equal8(x, y) && !unequal8(x, y) && unequal8(x, z));
  assert(a !== null && x !== null);
  return 1;
}
