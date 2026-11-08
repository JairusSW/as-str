import { count } from "review-count";
import { callNamespace } from "review-namespace";

export function run(): i32 {
  return count("abcd".slice(1)) + callNamespace();
}
