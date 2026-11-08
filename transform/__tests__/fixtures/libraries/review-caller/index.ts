import { count as renamed } from "review-count";

export function callAlias(): i32 {
  return renamed("abc");
}
