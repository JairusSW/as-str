import { str } from "../../../assembly/index";

export function property(): bool {
  const a = "abc";
  const b = "xyz";
  const joined = str.slice(a, 1) + str.slice(b, 1);
  return !joined.isEmpty;
}

export function indexing(): bool {
  const a = "abc";
  const b = "xyz";
  const joined = str.slice(a, 1) + str.slice(b, 1);
  return joined[0].toString() == "98";
}
