export class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  put(value: T): void {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
  defaultValue<U = T>(value: U = this.value): U {
    return value;
  }
}
export function identity<T>(value: T): T {
  return value;
}
export function defaulted<T = string>(value: T): T {
  return value;
}
