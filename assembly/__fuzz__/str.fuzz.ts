// Differential fuzzing against native String behavior.

import { expect, fuzz, FuzzSeed } from "as-test";
import { str } from "../index";

// Fixed corpus with entries long enough for SWAR/SIMD paths.
const CORPUS: string[] = [
  "",
  "a",
  "hello, world",
  "  padded \t string \n ",
  "the quick brown fox",
  "😀 mixed 字 surrogates 𝕏",
  "aaaaaaaa",
  "x,y,,z,",
  "the quick brown fox jumps over the lazy dog, again and again and again",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaXaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
];

// Single-char needles for `findUnit`.
const NEEDLES: string[] = ["a", "X", "z", "9", " ", ",", "字", "?"];

// @ts-ignore: decorator
@inline function pickNeedle(seed: u32): string {
  return NEEDLES[<i32>(seed % <u32>NEEDLES.length)];
}

// @ts-ignore: decorator
@inline function pick(seed: u32): string {
  return CORPUS[<i32>(seed % <u32>CORPUS.length)];
}

// @ts-ignore: decorator
@inline function idx(seed: u32, len: i32): i32 {
  // Bias toward in-range values but allow out-of-range and negatives.
  const span = len * 2 + 4;
  return <i32>(seed % <u32>span) - len - 2;
}

fuzz("slice matches native String#slice", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const start = idx(b, s.length);
  const end = idx(c, s.length);
  expect(str.slice(s, start, end).toString()).toBe(s.slice(start, end));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("substring matches native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const start = idx(b, s.length);
  const end = idx(c, s.length);
  expect(str.substring(s, start, end).toString()).toBe(s.substring(start, end));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("trim matches native", (a: u32): bool => {
  const s = pick(a);
  expect(str.trim(s).toString()).toBe(s.trim());
  expect(str.trimStart(s).toString()).toBe(s.trimStart());
  expect(str.trimEnd(s).toString()).toBe(s.trimEnd());
  return true;
}).generate((seed: FuzzSeed, run: (a: u32) => bool): void => {
  run(<u32>seed.u64());
});

fuzz("indexOf matches native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const needle = pick(b);
  const from = idx(c, s.length);
  expect(str.indexOf(s, needle, from)).toBe(s.indexOf(needle, from));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

// Exercise SWAR/SIMD `findUnit` lanes directly.
fuzz("indexOf(char) matches native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const ch = pickNeedle(b);
  const from = idx(c, s.length);
  expect(str.indexOf(s, ch, from)).toBe(s.indexOf(ch, from));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("lastIndexOf matches native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const needle = pickNeedle(b);
  const from = idx(c, s.length);
  expect(str.lastIndexOf(s, needle, from)).toBe(s.lastIndexOf(needle, from));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

// Compare sign must match native ordering.
fuzz("compare agrees in sign with native", (a: u32, b: u32): bool => {
  const x = pick(a);
  const y = pick(b);
  const got = str.compare(x, y);
  const gotSign = got < 0 ? -1 : got > 0 ? 1 : 0;
  const want = x < y ? -1 : x > y ? 1 : 0;
  expect(gotSign).toBe(want);
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64());
});

// More operations.

fuzz(
  "concat matches native (string + view inputs)",
  (a: u32, b: u32, c: u32): bool => {
    const x = pick(a);
    const y = pick(b);
    expect(str.concat(x, y)).toBe(x + y);
    // View inputs on both sides.
    const k = idx(c, x.length);
    expect(str.concat(str.slice(x, k), str.from(y))).toBe(x.slice(k) + y);
    return true;
  },
).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("repeat matches native", (a: u32, b: u32): bool => {
  const x = pick(a);
  const n = <i32>(b % 6); // 0..5
  expect(str.repeat(x, n)).toBe(x.repeat(n));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64());
});

fuzz("padStart/padEnd match native", (a: u32, b: u32, c: u32): bool => {
  const x = pick(a);
  const pad = pickNeedle(b); // always non-empty
  const len = <i32>(c % 40); // 0..39
  expect(str.padStart(x, len, pad)).toBe(x.padStart(len, pad));
  expect(str.padEnd(x, len, pad)).toBe(x.padEnd(len, pad));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("startsWith/endsWith match native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const probe = pick(b);
  const pos = idx(c, s.length);
  expect(str.startsWith(s, probe, pos)).toBe(s.startsWith(probe, pos));
  expect(str.endsWith(s, probe, pos)).toBe(s.endsWith(probe, pos));
  // `str` and string needles must agree.
  expect(str.startsWith(s, str.from(probe), pos)).toBe(
    s.startsWith(probe, pos),
  );
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("indexOf with a str needle == string needle", (a: u32, b: u32): bool => {
  const s = pick(a);
  const needle = pickNeedle(b);
  expect(str.indexOf(s, str.from(needle))).toBe(s.indexOf(needle));
  expect(str.includes(s, str.from(needle))).toBe(s.includes(needle));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64());
});

// Use local replace references; native `String#replace*` is unreliable here.
function refReplace(s: string, search: string, repl: string): string {
  const i = s.indexOf(search);
  if (i < 0 || search.length == 0) return s;
  return s.slice(0, i) + repl + s.slice(i + search.length);
}
function refReplaceAll(s: string, search: string, repl: string): string {
  if (search.length == 0) return s; // skip the empty-search edge here
  let out = "";
  let from = 0;
  let i = s.indexOf(search, from);
  while (i >= 0) {
    out += s.slice(from, i) + repl;
    from = i + search.length;
    i = s.indexOf(search, from);
  }
  return out + s.slice(from);
}

fuzz(
  "replace/replaceAll match a trusted reference",
  (a: u32, b: u32, c: u32): bool => {
    const s = pick(a);
    const search = pickNeedle(b);
    const repl = pick(c);
    expect(str.replace(s, search, repl)).toBe(refReplace(s, search, repl));
    expect(str.replaceAll(s, search, repl)).toBe(
      refReplaceAll(s, search, repl),
    );
    return true;
  },
).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("[] operator matches charCodeAt", (a: u32, b: u32): bool => {
  const s = pick(a);
  const v = str.from(s);
  const i = idx(b, s.length);
  const want = <u32>i < <u32>s.length ? s.charCodeAt(i) : -1;
  expect(v[i]).toBe(want);
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64());
});
