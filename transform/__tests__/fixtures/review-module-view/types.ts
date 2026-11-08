import { str } from "../../../../assembly/index";

export type Text = str;

export function makeText(): Text {
  return str.from("abc");
}
