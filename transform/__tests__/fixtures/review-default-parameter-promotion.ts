import { str } from "../../../assembly/index";

function measure(value: string = "abc"): i32 {
  return str.slice(value, 1).length + str.trim(value).length;
}

export function run(): i32 {
  return measure() + measure("abcdef".slice(1));
}

function explicitMeasure(value: string): i32 {
  return str.slice(value, 1).length + str.trim(value).length;
}

export function explicitControl(): i32 {
  return explicitMeasure("abc") + explicitMeasure("abcdef".slice(1));
}
