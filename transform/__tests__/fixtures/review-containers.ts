function measure(value: string): i32 {
  return value.length;
}
class Box {
  constructor(public value: i32) {}
}
export function constructed(): i32 {
  return new Box(measure("abcdef".slice(1, 4))).value;
}
export function arrayLiteral(): i32 {
  const values: i32[] = [measure("abcdef".slice(1, 4))];
  return values[0];
}
export function ternary(flag: bool = true): i32 {
  return flag ? measure("abcdef".slice(1, 4)) : 0;
}
export function comma(): i32 {
  return (0, measure("abcdef".slice(1, 4)));
}
