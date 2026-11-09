import { measure } from "selected-api";
import { outside } from "outside-api";

export function run(): i32 {
  return measure("abcdef".slice(1)) + outside();
}
