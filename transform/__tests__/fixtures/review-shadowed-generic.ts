// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter preserves the shadowing generic in the compiled fixture.
function check<u64>(unused: u64): bool {
  const input = "abc";
  const part = input.slice(1);
  return part == "bc";
}

export function run(): bool {
  return check<i32>(0);
}
