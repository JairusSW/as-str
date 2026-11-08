import { str } from "../../../assembly/index";

class Reader {
  constructor(public value: str) {}


  @operator("[]")
  get(index: i32): i32 {
    this.value.set(str.from("x"));
    return index;
  }
}

export function overloaded(): i32 {
  const source = "abcdef";
  const part = source.slice(1);
  const view = str.from(part);
  const reader = new Reader(view);
  const read = reader[0];
  return part.length + read;
}

export function explicit(): i32 {
  const source = "abcdef";
  const part = source.slice(1);
  const view = str.from(part);
  const reader = new Reader(view);
  const read = reader.get(0);
  return part.length + read;
}
