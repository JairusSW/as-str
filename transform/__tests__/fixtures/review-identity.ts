function sameAddress(a: string, b: string): bool {
  return changetype<usize>(a) == changetype<usize>(b);
}
export function check(): bool {
  const original: string = "abc";
  const lower = original.toLowerCase();
  return lower.length == 3 && sameAddress(original, lower);
}
