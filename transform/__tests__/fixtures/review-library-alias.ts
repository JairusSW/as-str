import { count } from "review-count";
import { callAlias } from "review-caller";

export function run(): i32 {
  return count("abcd".slice(1)) + callAlias();
}
