import { str } from "../../../assembly/index";

class Holder {
  private stored: str = str.from("abc");

  get value(): string {
    return this.stored.toString();
  }

  set value(value: str) {
    this.stored = value;
  }
}

class SetterOnly {
  private stored: str = str.from("abc");

  set value(value: str) {
    this.stored = value;
  }

  readValue(): string {
    return this.stored.toString();
  }
}

export function differentTypes(): i32 {
  const holder = new Holder();
  holder.value = str.from("de");
  return holder.value.length;
}

export function setterOnly(): i32 {
  const holder = new SetterOnly();
  holder.value = str.from("de");
  return holder.readValue().length;
}
