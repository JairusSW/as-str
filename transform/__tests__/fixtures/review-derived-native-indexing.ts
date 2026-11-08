import { str } from "../../../assembly/index";

export function charAtResult(): bool {
  const part = "abcdef".slice(1);
  return part.length == 5 && part.charCodeAt(1) == 99
    ? part.charAt(0)[0].toString() == "b"
    : false;
}

export function sliceResult(): bool {
  const part = "abcdef".slice(1);
  return part.length == 5 && part.charCodeAt(1) == 99
    ? part.slice(0)[0].toString() == "b"
    : false;
}

export function substringResult(): bool {
  const part = "abcdef".slice(1);
  return part.length == 5 && part.charCodeAt(1) == 99
    ? part.substring(0, 1)[0].toString() == "b"
    : false;
}

export function longerChain(): bool {
  const part = "abcdef".slice(1);
  return part.length == 5 && part.charCodeAt(1) == 99
    ? part.slice(0).substring(0, 1)[0].toString() == "b"
    : false;
}

export function explicitView(): bool {
  const part = str.from("abcdef").slice(1);
  return part.charAt(0)[0].toString() == "98";
}
