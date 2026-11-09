import { str } from "../../../assembly/index";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally collides with the callback property name.
function callback(value: str): i32 {
  return value.length;
}

function nativeA(value: string): i32 {
  return value.length;
}

function nativeB(value: string): i32 {
  return value.length + 10;
}

class Holder {
  constructor(public callback: (value: string) => i32) {}
}

function invoke(flag: bool): i32 {
  const first = new Holder(nativeA);
  const second = new Holder(nativeB);
  const chosen = flag ? first : second;
  return chosen.callback("abc");
}

function invokeTyped(flag: bool): i32 {
  const first = new Holder(nativeA);
  const second = new Holder(nativeB);
  const chosen: Holder = flag ? first : second;
  return chosen.callback("abc");
}

export function runTrue(): i32 {
  return invoke(true);
}

export function runFalse(): i32 {
  return invoke(false);
}

export function typedTrue(): i32 {
  return invokeTyped(true);
}

export function typedFalse(): i32 {
  return invokeTyped(false);
}
