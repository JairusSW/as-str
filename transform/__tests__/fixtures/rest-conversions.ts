function viewLength(...values: str[]): i32 {
  let length = 0;
  for (let i = 0; i < values.length; i++) length += values[i].length;
  return length;
}
function nativeLength(...values: string[]): i32 {
  let length = 0;
  for (let i = 0; i < values.length; i++) length += values[i].length;
  return length;
}
function first<T>(...values: T[]): T {
  return values[0];
}
class Consumer<T> {
  count(...values: T[]): i32 {
    return values.length;
  }
}
export function viewRest(): i32 {
  return viewLength("abc", "defg");
}
export function nativeRest(): i32 {
  return nativeLength(str.from("abcdef").slice(1, 4), str.from("defg"));
}
export function genericRest(): i32 {
  const native: string = first<str>("abc", "defg");
  return native.length;
}
export function genericRestMethods(): i32 {
  const view = new Consumer<str>();
  const native = new Consumer<string>();
  const primitive = new Consumer<i32>();
  return (
    view.count("abc", "defg") +
    native.count(str.from("a"), str.from("b")) +
    primitive.count(7, 8)
  );
}
export function callbackRest(): i32 {
  let callback: (...values: str[]) => i32 = (...values: str[]): i32 =>
    values.length;
  const first = callback("a");
  callback = (...values: str[]): i32 => values[0].length + values[1].length;
  return first + callback("abc", "defg");
}
let calls = 0;
function value(index: i32): string {
  calls = calls * 10 + index;
  return index === 1 ? "abc" : "defg";
}
function prefixed(prefix: string, ...values: str[]): i32 {
  return prefix.length + values[0].length + values[1].length;
}
export function restEvaluationOrder(): i32 {
  calls = 0;
  const length = prefixed("abcdef".slice(0, 1), value(1), value(2));
  return calls * 100 + length;
}
export function emptyRest(): i32 {
  return viewLength();
}
