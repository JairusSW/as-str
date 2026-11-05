import { str, str8 } from "../../../assembly/index";
export function run(): i32 {
  const a = str.from("abcabc");
  const b = str8.from("abcabc");
  assert(a.includes("abc", 3) && !a.includes("abc", 4));
  assert(b.includes("abc", 3) && !b.includes("abc", 4));
  assert(str.includes("abcabc", "abc", 3) && !str.includes(a, "abc", 4));
  assert(str8.includes(b, "abc", 3) && !str8.includes(b, "abc", 4));
  assert(a.split().length == 1 && a.split(null)[0].toString() == "abcabc");
  assert(b.split().length == 1 && b.split(null)[0].toString() == "abcabc");
  assert(str.split(a).length == 1 && str.split(a, null, 0).length == 0);
  assert(str8.split(b).length == 1 && str8.split(b, null, 0).length == 0);
  assert(str.from("").split().length == 1 && str8.from("").split().length == 1);
  return 1;
}
