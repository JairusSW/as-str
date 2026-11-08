// eslint-disable-next-line @typescript-eslint/no-unused-vars
type u64 = i32;

export function run(): bool {
  const input = "abc";
  const part = input.slice(1);
  return part == "bc";
}
