import { str } from "../../../assembly/index";

class Box<T> {
  value: T;

  constructor(...values: T[]) {
    this.value = values[0];
  }

  put(value: T): void {
    this.value = value;
  }
}

class Base {
  constructor(public marker: str) {}
}

class Derived<T = string> extends Base {
  take(value: T): i32 {
    return value.toString().length;
  }
}

export function rest(): i32 {
  const first: str[] = [str.from("abc")];
  const box = new Box(first);
  const second: str[] = [str.from("de"), str.from("f")];
  box.put(second);
  return box.value.length;
}

export function restExplicit(): i32 {
  const first: str[] = [str.from("abc")];
  const box = new Box<str[]>(first);
  const second: str[] = [str.from("de"), str.from("f")];
  box.put(second);
  return box.value.length;
}

export function inherited(): i32 {
  const box = new Derived(str.from("abc"));
  return box.take("de");
}

export function inheritedExplicit(): i32 {
  const box = new Derived<string>(str.from("abc"));
  return box.take("de");
}
