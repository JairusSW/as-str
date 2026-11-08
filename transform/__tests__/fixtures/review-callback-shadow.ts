import { str } from "../../../assembly/index";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally shadowed by the local callback.
function callback(value: str): i32 {
  return value.length;
}

function nativeA(value: string): i32 {
  return value.length;
}

function nativeB(value: string): i32 {
  return value.length + 10;
}

function invoke(flag: bool): i32 {
  const callback: (value: string) => i32 = flag ? nativeA : nativeB;
  return callback("abc");
}

export function runTrue(): i32 {
  return invoke(true);
}

export function runFalse(): i32 {
  return invoke(false);
}
