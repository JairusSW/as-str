import { str } from "../../../assembly/index";
class Box {
  value: i32 = 0;
  constructor(public str: i32) {
    this.value = "abc".includes("b", 0) ? 1 : 0;
  }
}
export function run(): i32 {
  return new Box(1).value + str.from("x").length;
}
