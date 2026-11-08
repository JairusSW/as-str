import * as pkg from "review-count";

export function run(): i32 {
  return pkg.count("abcdef".slice(1));
}
