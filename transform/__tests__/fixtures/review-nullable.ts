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
  if (!(equal16(null, null) && !unequal16(null, null))) return 0;
  if (!(!equal16(a, null) && !equal16(null, a))) return 0;
  if (!(unequal16(a, null) && unequal16(null, a))) return 0;
  if (!(equal16(a, b) && !unequal16(a, b) && unequal16(a, c))) return 0;
  if (!(equal8(null, null) && !unequal8(null, null))) return 0;
  if (!(!equal8(x, null) && !equal8(null, x))) return 0;
  if (!(unequal8(x, null) && unequal8(null, x))) return 0;
  if (!(equal8(x, y) && !unequal8(x, y) && unequal8(x, z))) return 0;
  if (!(a !== null && x !== null)) return 0;
  return 1;
}
