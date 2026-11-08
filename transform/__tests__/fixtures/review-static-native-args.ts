import { Str, str } from "../../../assembly/index";

export function lowercaseReplace(): bool {
  const owner = "__aa__";
  const needle = owner.slice(2, 4);
  return str.replace("aaaa", needle, "X") == "Xaa";
}

export function uppercaseReplace(): bool {
  const owner = "__aa__";
  const needle = owner.slice(2, 4);
  return Str.replace("aaaa", needle, "X") == "Xaa";
}

export function genericNeedle(): bool {
  const owner = "__aa__";
  const needle = owner.slice(2, 4);
  return str.indexOf("aaaa", needle) == 0;
}

export function nativeReplacement(): bool {
  const owner = "__X__";
  const replacement = owner.slice(2, 3);
  return str.replace("aaaa", "aa", replacement) == "Xaa";
}

export function nativePadding(): bool {
  const owner = "__0__";
  const padding = owner.slice(2, 3);
  return str.padStart("x", 3, padding) == "00x";
}

export function nativeSeparator(): bool {
  const owner = "__,__";
  const separator = owner.slice(2, 3);
  return str.split("a,b", separator).length == 2;
}
