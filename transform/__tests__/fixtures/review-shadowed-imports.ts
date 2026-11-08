/* eslint-disable @typescript-eslint/no-unused-vars -- imported aliases intentionally shadow generated primitive annotations. */
import { Small as u64, Native as i32 } from "./review-shadowed-import-types";

export function packed(): bool {
  const input = "abc";
  const part = input.slice(1);
  return part == "bc";
}

export function character(): bool {
  const text = "a";
  const c = text.charAt(0);
  return c == "a";
}
