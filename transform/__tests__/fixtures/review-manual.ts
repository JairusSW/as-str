import { str, str8 } from "../../../assembly/index";
export function run(): i32 {
  const a = str.from("abcabc");
  const b = str8.from("abcabc");
  if (!(a.includes("abc", 3) && !a.includes("abc", 4))) return 0;
  if (!(b.includes("abc", 3) && !b.includes("abc", 4))) return 0;
  if (!(str.includes("abcabc", "abc", 3) && !str.includes(a, "abc", 4)))
    return 0;
  if (!(str8.includes(b, "abc", 3) && !str8.includes(b, "abc", 4))) return 0;
  if (!(a.split().length == 1 && a.split(null)[0].toString() == "abcabc"))
    return 0;
  if (!(b.split().length == 1 && b.split(null)[0].toString() == "abcabc"))
    return 0;
  if (!(str.split(a).length == 1 && str.split(a, null, 0).length == 0))
    return 0;
  if (!(str8.split(b).length == 1 && str8.split(b, null, 0).length == 0))
    return 0;
  if (!(str.from("").split().length == 1 && str8.from("").split().length == 1))
    return 0;
  return 1;
}
