import { str, str8 } from "../../../assembly/index";
import { twoWayIndexOf, twoWayLastIndexOf } from "../../../assembly/util";
export function forced(
  hay: string,
  needle: string,
  from: i32,
  reverse: bool,
): i32 {
  const hp = changetype<usize>(hay),
    np = changetype<usize>(needle);
  const last = hay.length - needle.length;
  if (last < 0) return -1;
  return reverse
    ? twoWayLastIndexOf<u16>(hp, np, needle.length, min(max(from, 0), last))
    : twoWayIndexOf<u16>(hp, hay.length, np, needle.length, max(from, 0));
}
export function units(
  hay: string,
  needle: string,
  from: i32,
  reverse: bool,
): i32 {
  const view = str.from(hay);
  return reverse ? view.lastIndexOf(needle, from) : view.indexOf(needle, from);
}
export function bytes(
  hay: string,
  needle: string,
  from: i32,
  reverse: bool,
): i32 {
  const view = str8.from(hay),
    n = str8.from(needle);
  return reverse ? view.lastIndexOf(n, from) : view.indexOf(n, from);
}
