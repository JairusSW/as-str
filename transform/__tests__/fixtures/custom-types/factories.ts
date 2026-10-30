import { Holder } from "./holder";
import { str } from "../../../../assembly/index";
let calls = 0;
export function create(): Holder {
  return new Holder();
}
export function populated(): Holder {
  calls++;
  const holder = new Holder();
  holder.view = str.from("abc");
  return holder;
}
export function reset(): void {
  calls = 0;
}
export function count(): i32 {
  return calls;
}
export const shared = new Holder();
export let callback: () => Holder = (): Holder => new Holder();
export function replace(): void {
  callback = (): Holder => shared;
}
