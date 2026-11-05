function sameAddress(a: string, b: string): bool {
  return changetype<usize>(a) == changetype<usize>(b);
}
export function check(): bool {
  const original: string = "abc";
  const lower = original.toLowerCase();
  return lower.length == 3 && sameAddress(original, lower);
}
function source(value: string): string {
  return value;
}
export function repeatedCheck(): bool {
  const original: string = "abc";
  return sameAddress(original.toLowerCase(), original.toLowerCase());
}
export function returnedCheck(): bool {
  const original: string = "abc";
  return sameAddress(original, source(original).toLowerCase());
}
