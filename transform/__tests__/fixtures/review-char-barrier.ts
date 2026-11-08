import { str } from "../../../assembly/index";
export function run(): i32 {
  const source = "a".repeat(2);
  const view = str.from(source);
  const c: str = view.charAt(0);
  store<u16>(changetype<usize>(source), 98);
  return c == "b" ? 1 : 0;
}
