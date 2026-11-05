class Base {
  change(value: string): string {
    return value;
  }
}
class Derived extends Base {
  change(value: string): string {
    store<u16>(changetype<usize>(value) + 2, 120);
    return "bcd";
  }
}
function check(editor: Base, original: string): bool {
  const part = original.slice(1, 4);
  return part == editor.change(original);
}
export function run(): bool {
  return check(
    new Derived(),
    String.fromCharCodes([97, 98, 99, 100, 101, 102]),
  );
}
export function baseControl(): bool {
  return check(new Base(), String.fromCharCodes([97, 98, 99, 100, 101, 102]));
}
class ConstructorBase {
  constructor(value: string) {
    this.touch(value);
  }
  touch(value: string): void {
    if (value.length) return;
  }
}
class ConstructorDerived extends ConstructorBase {
  touch(value: string): void {
    store<u16>(changetype<usize>(value) + 2, 120);
  }
}
export function constructorDispatch(): bool {
  const original = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
  const part = original.slice(1, 4);
  new ConstructorDerived(original);
  return part == "bcd";
}
