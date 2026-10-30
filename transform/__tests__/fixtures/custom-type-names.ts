/* eslint-disable @typescript-eslint/no-unused-vars -- Stub method arguments are deliberately unused. */
class Str {
  length: i32 = 31;
  slice(start: i32 = 0, end: i32 = 0): Str {
    return this;
  }
  at(index: i32): Str {
    return this;
  }
}
class String {
  length: i32 = 17;
  slice(start: i32 = 0, end: i32 = 0): String {
    return this;
  }
  at(index: i32): String {
    return this;
  }
}
export function customViewName(): i32 {
  const value: Str = new Str();
  return value.slice(1, 2).length + value.at(50).length;
}
export function customStringName(): i32 {
  const value: String = new String();
  return value.slice(1, 2).length + value.at(50).length;
}
