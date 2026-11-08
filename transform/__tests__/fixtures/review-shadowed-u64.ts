// eslint-disable-next-line @typescript-eslint/no-unused-vars
type u64 = i32;

export function run(): bool {
  const input = "abc";
  const part = input.slice(1);
  return part == "bc";
}

function measure(value: string): i32 {
  return value.length;
}

function tail(value: string): string {
  return value.slice(1);
}

export function parameter(): i32 {
  return measure("abc".slice(1));
}

export function returned(): i32 {
  return tail("abc").length;
}
