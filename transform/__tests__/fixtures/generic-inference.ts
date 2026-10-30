class Box<T = string> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
function defaulted<T = string>(value: T): T {
  return value;
}
export function inferredViewIdentity(): i32 {
  const view = str.from("abc");
  const result = defaulted(view);
  result.start += 2;
  return view.length * 10 + result.length;
}
export function inferredBoxIdentity(): i32 {
  const view = str.from("abc");
  const box = new Box(view);
  const result = box.value;
  result.start += 2;
  return view.length * 100 + box.value.length * 10 + result.length;
}
export function inferredNative(): i32 {
  return defaulted("abc").length;
}
class Parent {
  value: string = "abc";
}
class Child extends Parent {}
function second<T = Child>(first: T, last: T): T {
  return first === last ? first : last;
}
export function widenedInference(): i32 {
  return second(new Child(), new Parent()).value.length;
}
function nullable(value: str | null): i32 {
  const box = new Box(value);
  box.value = null;
  return box.value ? 1 : 17;
}
export function inferredNullable(): i32 {
  return nullable(str.from("abc"));
}
function omitted<T = string>(value: T = str.from("abc")): T {
  return value;
}
export function inferredDefaultInitializer(): i32 {
  const result: str = omitted();
  result.start += 2;
  return result.length;
}
class DefaultBox<T = string> {
  value: T;
  constructor(value: T = str.from("abc")) {
    this.value = value;
  }
}
export function inferredConstructorDefault(): i32 {
  const box = new DefaultBox();
  const result: str = box.value;
  result.start += 2;
  return box.value.length * 10 + result.length;
}
