import { str } from "../../../assembly/index";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally shadows the native type name.
type string = str;

class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  put(value: T): void {
    this.value = value;
  }
}

export function run(): i32 {
  const box = new Box("abc");
  box.put("defg");
  return box.value.length;
}
