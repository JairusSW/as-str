import { Tool as str } from "./custom-types/tools";
export function native(): i32 {
  const input: string = "abcdef";
  const view = input.slice(1, 4);
  return view.length;
}
export function custom(): i32 {
  return str.from("abc").length;
}
