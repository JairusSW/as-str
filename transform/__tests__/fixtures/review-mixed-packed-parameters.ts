import { str } from "../../../assembly/index";

function measure(first: string, second: str): i32 {
  return first.length + second.length;
}

export function run(): i32 {
  return measure("abcdef".slice(1), str.from("ghi"));
}

function measureMany(first: string, second: string, third: str): i32 {
  return first.length + second.length + third.length;
}

export function multiple(): i32 {
  return measureMany("abcdef".slice(1), "wxyz".slice(1), str.from("hi"));
}
