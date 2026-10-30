import { Str, str, str8 } from "../../assembly/index";
import { equalsBytes } from "../../assembly/util";

let text: string = "";
let needle: string = "";
let view: str8 = str8.from("");
let probe: str8 = str8.from("");

export function setup(size: i32, scenario: i32): void {
  if (scenario == 0) {
    text = "b" + "a".repeat(size - 1);
    needle = "b";
  } else if (scenario == 1) {
    text = "a".repeat(size);
    needle = "b";
  } else if (scenario == 2) {
    text = "a".repeat(size - 1) + "b";
    needle = "b";
  } else if (scenario == 3) {
    text = "abc" + "x".repeat(size - 3);
    needle = "abc";
  } else if (scenario == 4) {
    text = "a".repeat(size);
    needle = "ab";
  } else if (scenario == 5) {
    text = "ab";
    needle = "ab";
  } else if (scenario == 6) {
    text = "a😀é世".repeat(size);
    needle = "a";
  } else if (scenario == 7) {
    text = "a" + "x".repeat(size - 1);
    needle = "ab";
  } else if (scenario == 8) {
    text = "axax" + "x".repeat(size - 4);
    needle = "ab";
  } else if (scenario == 9) {
    text = "a".repeat(size);
    needle = "aba";
  } else if (scenario == 10) {
    text = "a".repeat(size);
    needle = "ba";
  } else {
    text = "a".repeat(min(size, 8)) + "x".repeat(max(0, size - 8));
    needle = "ab";
  }
  // Offset views exercise unaligned loads and keep setup outside measurements.
  view = str8.from("<" + text + ">").slice(1, -1);
  probe = str8.from(needle);
}

export function setupEquality(size: i32, mismatch: i32): void {
  text = "a".repeat(size);
  needle =
    mismatch < 0 || size == 0
      ? ("<" + text).slice(1)
      : text.slice(0, mismatch) + "b" + text.slice(mismatch + 1);
  view = str8.from("<" + text + ">").slice(1, -1);
  probe = str8.from("[" + needle + "]").slice(1, -1);
}

export function equal16(iterations: i32): i32 {
  let sum = 0;
  const bytes = (<usize>text.length) << 1;
  for (let i = 0; i < iterations; i++) {
    const skip = bytes ? (<usize>(i & 1)) << 1 : 0;
    sum += <i32>(
      equalsBytes(
        changetype<usize>(text) + skip,
        changetype<usize>(needle) + skip,
        bytes - skip,
      )
    );
  }
  return sum;
}

export function equal8(iterations: i32): i32 {
  let sum = 0;
  const bytes = <usize>view.length;
  for (let i = 0; i < iterations; i++) {
    const skip = bytes ? <usize>(i & 1) : 0;
    sum += <i32>(
      equalsBytes(view.start + skip, probe.start + skip, bytes - skip)
    );
  }
  return sum;
}

export function last16(iterations: i32): i32 {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += str.lastIndexOf(text, needle, text.length - (i & 7));
  }
  return sum;
}

export function last8(iterations: i32): i32 {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += view.lastIndexOf(probe, view.length - (i & 7));
  }
  return sum;
}

export function first16(iterations: i32): i32 {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += str.indexOf(text, needle, i & 7);
  }
  return sum;
}

export function first8(iterations: i32): i32 {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += view.indexOf(probe, i & 7);
  }
  return sum;
}

export function fill(kind: i32, count: i32, iterations: i32): i32 {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    if (kind == 0) {
      const result = str.repeat(text, count);
      sum += result.length + result.charCodeAt(i % result.length);
    } else if (kind == 1) {
      const result = view.repeat(count);
      sum += result.length + result.byteAt(i % result.length);
    } else if (kind == 2) {
      const result = str.padEnd("x", count * 2, needle);
      sum += result.length + result.charCodeAt(i % result.length);
    } else {
      const result = view.padStart(count * 2, needle);
      sum += result.length + result.byteAt(i % result.length);
    }
  }
  return sum;
}

export function sliceChars(kind: i32, iterations: i32): i32 {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    let result: str8;
    if (kind == 0) result = view.sliceChars(i & 3, 4);
    else if (kind == 1) result = view.sliceChars(i & 3);
    else if (kind == 2) result = view.sliceChars(-4, -1);
    else result = view.sliceChars(i & 3, i32.MAX_VALUE - 1);
    sum += result.length + result.byteAt(0);
  }
  return sum;
}

const trimValues = new Array<string>();
export function setupTrim(scenario: i32): void {
  trimValues.length = 0;
  for (let i = 0; i < 16; i++) {
    let value = (scenario >= 3 ? "東京É😀" : "record") + i.toString();
    if (scenario == 1) value = " \t" + value + "\r\n";
    if (scenario == 2) value = " ".repeat(64) + value + " ".repeat(64);
    if (scenario == 4) value = "\u2003\u3000" + value + "\u00a0\ufeff";
    trimValues.push(value);
  }
}
export function trim16(kind: i32, iterations: i32): i32 {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const value = trimValues[i & 15];
    if (kind == 0) sum += Str.trimLength(value);
    else if (kind == 1) sum += Str.trimStartLength(value);
    else if (kind == 2) sum += Str.trimEndLength(value);
    else if (kind == 3) sum += str.trim(value).length;
    else if (kind == 4) sum += str.trimStart(value).length;
    else sum += str.trimEnd(value).length;
  }
  return sum;
}
