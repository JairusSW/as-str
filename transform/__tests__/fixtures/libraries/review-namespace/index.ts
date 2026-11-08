import * as pkg from "review-count";

export function callNamespace(): i32 {
  return pkg.count("abc");
}
