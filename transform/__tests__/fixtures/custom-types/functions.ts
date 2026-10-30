/* eslint-disable @typescript-eslint/no-namespace -- AssemblyScript callable namespace regression. */
import { str } from "../../../../assembly/index";
export function consume(value: str): i32 {
  return value.length;
}
export function produce(): str {
  return str.from("abc");
}
export const alias = consume;
export const callback = (value: str): str => value;
export namespace API {
  export function consume(value: str): i32 {
    return value.length + 10;
  }
  export function produce(): str {
    return str.from("defg");
  }
}
export let mutable: (value: str) => str = (value: str): str => value;
export const sharedView: str = str.from("abc");

export function replaceCallback(): void {
  mutable = (value: str): str => value.slice(0, 2);
}
