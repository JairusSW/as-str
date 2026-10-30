import { str } from "./custom-types/view-api";
export function native(): i32 {
  const input: string = "abcdef";
  const view = input.slice(1, 4);
  return view.length;
}
export function explicit(): i32 {
  return str.from("abc").at(50).length;
}
