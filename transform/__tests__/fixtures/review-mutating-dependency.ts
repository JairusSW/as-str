export function overwrite(value: string): string {
  store<u16>(changetype<usize>(value) + 2, 120);
  return "bcd";
}
