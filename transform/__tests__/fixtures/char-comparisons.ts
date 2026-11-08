/* eslint-disable prefer-const, no-duplicate-case -- reassigned locals and repeated labels are regression cases. */
const TEXT = "a(b) 😀";

export function callForms(i: i32): i32 {
  let out = 0;
  if (TEXT.charAt(i) == "a") out |= 1;
  if ("(" == TEXT.charAt(i)) out |= 2;
  if (TEXT.charAt(i) != " ") out |= 4;
  if (TEXT.charAt(i) === "b") out |= 8;
  if (TEXT.charAt(i) !== ")") out |= 16;
  if (TEXT.charAt(i) == "") out |= 32;
  if ("" != TEXT.charAt(i)) out |= 64;
  if (TEXT.charAt(i) == "\uD83D") out |= 128;
  if (TEXT.charAt(i) == "ab") out |= 256;
  return out;
}

export function elementForms(i: i32): i32 {
  const text = TEXT;
  return (
    (text[i] == "a" ? 1 : 0) |
    (text[i] != "(" ? 2 : 0) |
    ("" == text[i] ? 4 : 0) |
    (text[i] === "\uDE00" ? 8 : 0)
  );
}

export function switchForm(i: i32): i32 {
  switch (TEXT.charAt(i)) {
    case "a":
      return 1;
    case "(":
    case ")":
      return 2;
    case "a":
      return 3;
    case "":
      return 4;
    default:
      return 5;
  }
}

export function scalarLocal(i: i32): i32 {
  const c = TEXT.charAt(i);
  let out = 0;
  if (c == "a" || c == "b") out |= 1;
  if (c != " ") out |= 2;
  if ("" == c) out |= 4;
  switch (c) {
    case "(":
      out |= 8;
      break;
    default:
      out |= 16;
  }
  return out;
}

export function typedScalarLocal(i: i32): i32 {
  const c: string = TEXT[i];
  return c == "b" ? 1 : c == "" ? 2 : 3;
}

export function reassignedLocal(i: i32): i32 {
  let c = TEXT.charAt(i);
  if (c == "a") c = "zz";
  return c == "zz" ? 1 : c.length;
}

export function otherUseLocal(i: i32): i32 {
  const c = TEXT.charAt(i);
  return (c == "a" ? 1 : 0) + c.length * 2 + (c == TEXT.charAt(0) ? 4 : 0);
}

let c = "a";
export function shadowedLocal(i: i32): i32 {
  let out = 0;
  if (i > 0) {
    const c = TEXT.charAt(i);
    if (c == "b") out |= 1;
  }
  if (c == "a") out |= 2;
  return out;
}

class Box {
  charAt(i: i32): string {
    return i == 0 ? "x" : "";
  }
}

export function userClass(i: i32): i32 {
  return new Box().charAt(i) == "x" ? 1 : 0;
}

let calls = 0;
function source(): string {
  calls++;
  return TEXT;
}
function position(i: i32): i32 {
  calls *= 3;
  return i;
}

export function effects(i: i32): i32 {
  calls = 1;
  const hit = source().charAt(position(i)) == "(" ? 100 : 0;
  return hit + calls;
}

export function ordering(i: i32): i32 {
  const text = "a0 9z~";
  const c = text.charAt(i);
  let out = 0;
  if (c >= "0" && c <= "9") out |= 1;
  if ("a" < c) out |= 2;
  if (c > "") out |= 4;
  if (text.charAt(i) <= "") out |= 8;
  if ("~" >= text[i]) out |= 16;
  if (text.charAt(i) < "\uD800") out |= 32;
  return out;
}
