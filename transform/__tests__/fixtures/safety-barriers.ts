function nativeLength(value: string): i32 {
  return value.length;
}

export function nativeCall(input: string): i32 {
  const part = input.slice(1, 4);
  return nativeLength(part);
}

export function explicitCast(input: string): string {
  const part = input.slice(1, 4);
  return part as string;
}

export function rawStore(input: string, pointer: usize): void {
  const part = input.slice(1, 4);
  store<string>(pointer, part);
}

export function directLoad(pointer: usize): string {
  return load<string>(pointer);
}

function genericIdentity<T>(value: T): T {
  return value;
}

export function genericBoundary(input: string): i32 {
  const part = input.slice(1, 4);
  return genericIdentity<string>(part).length;
}

export function containerBoundary(input: string): i32 {
  const values = new Array<string>();
  const part = input.slice(1, 4);
  values.push(part);
  return values.length;
}

class NativeField {
  value: string = "";
}

export function fieldBoundary(input: string): i32 {
  const target = new NativeField();
  const part = input.slice(1, 4);
  target.value = part;
  return target.value.length;
}

function nullableLength(value: string | null): i32 {
  return value ? value.length : 0;
}

export function nullableBoundary(input: string): i32 {
  const part = input.slice(1, 4);
  return nullableLength(part);
}

export function templateBoundary(input: string): string {
  const part = input.slice(1, 4);
  return `value=${part}`;
}

export function concatBoundary(input: string): string {
  const part = input.slice(1, 4);
  return "value=" + part;
}

export function preferredUnsafe(input: string): usize {
  // @as-str prefer-view
  const preferred = input.slice(1, 4);
  return changetype<usize>(preferred);
}
