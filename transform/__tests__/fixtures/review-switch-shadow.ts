// eslint-disable-next-line @typescript-eslint/no-unused-vars -- regression: shadows the generated table type.
class StaticArray<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
}
export function run(): i32 {
  const s = " a";
  switch (s.substring(1).trim()) {
    case "a":
      return 1;
    default:
      return 2;
  }
}
