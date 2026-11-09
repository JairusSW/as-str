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

class GenericBase<T> {
  constructor(public value: T) {}
}

class ViewDerived<T = string> extends GenericBase<T> {
  put(value: T): void {
    this.value = value;
  }
}

class NativeDerived<T = str> extends GenericBase<T> {
  put(value: T): void {
    this.value = value;
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

export function inheritedGenericView(): i32 {
  const box = new ViewDerived(str.from("abc"));
  box.put(str.from("de"));
  return box.value.length;
}

export function inheritedGenericNative(): i32 {
  const box = new NativeDerived("abc");
  box.put("de");
  return box.value.length;
}
