// This module participates in analysis but cannot receive the str import.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the binding blocks rewrite admission.
class str {}

export function mutate(value: string): string {
  store<u16>(changetype<usize>(value) + 2, 120);
  return "bcd";
}
