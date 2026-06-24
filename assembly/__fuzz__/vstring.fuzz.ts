// Differential fuzzing: a materialized vstring view must agree, character for
// character, with the equivalent native String operation across random inputs.

import { expect, fuzz, FuzzSeed } from "as-test";
import { vstring } from "../index";

// A fixed corpus of backing strings; the fuzzer picks one plus random indices.
// Several entries are long enough to drive the SWAR (4-unit) and SIMD (8-unit)
// blocks plus their scalar tails inside `findUnit` / `compare`.
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

// A small alphabet of single-char needles to stress `findUnit` lane handling.
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
  expect(vstring.slice(s, start, end).toString()).toBe(s.slice(start, end));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("substring matches native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const start = idx(b, s.length);
  const end = idx(c, s.length);
  expect(vstring.substring(s, start, end).toString()).toBe(
    s.substring(start, end),
  );
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("trim matches native", (a: u32): bool => {
  const s = pick(a);
  expect(vstring.trim(s).toString()).toBe(s.trim());
  expect(vstring.trimStart(s).toString()).toBe(s.trimStart());
  expect(vstring.trimEnd(s).toString()).toBe(s.trimEnd());
  return true;
}).generate((seed: FuzzSeed, run: (a: u32) => bool): void => {
  run(<u32>seed.u64());
});

fuzz("indexOf matches native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const needle = pick(b);
  const from = idx(c, s.length);
  expect(vstring.indexOf(s, needle, from)).toBe(s.indexOf(needle, from));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

// Single-char needles exercise the SWAR/SIMD `findUnit` lanes directly.
fuzz("indexOf(char) matches native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const ch = pickNeedle(b);
  const from = idx(c, s.length);
  expect(vstring.indexOf(s, ch, from)).toBe(s.indexOf(ch, from));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("lastIndexOf matches native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const needle = pickNeedle(b);
  const from = idx(c, s.length);
  expect(vstring.lastIndexOf(s, needle, from)).toBe(
    s.lastIndexOf(needle, from),
  );
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

// Ordering must agree in sign with the native `<` / `>` operators across the
// SWAR/SIMD block boundaries (shared prefixes, differing lanes, length ties).
fuzz("compare agrees in sign with native", (a: u32, b: u32): bool => {
  const x = pick(a);
  const y = pick(b);
  const got = vstring.compare(x, y);
  const gotSign = got < 0 ? -1 : got > 0 ? 1 : 0;
  const want = x < y ? -1 : x > y ? 1 : 0;
  expect(gotSign).toBe(want);
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64());
});

// ---- recently optimized / generalized ops ---------------------------------

fuzz(
  "concat matches native (string + view inputs)",
  (a: u32, b: u32, c: u32): bool => {
    const x = pick(a);
    const y = pick(b);
    expect(vstring.concat(x, y)).toBe(x + y);
    // a view as the primary, a view as the secondary
    const k = idx(c, x.length);
    expect(vstring.concat(vstring.slice(x, k), vstring.from(y))).toBe(
      x.slice(k) + y,
    );
    return true;
  },
).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("repeat matches native", (a: u32, b: u32): bool => {
  const x = pick(a);
  const n = <i32>(b % 6); // 0..5
  expect(vstring.repeat(x, n)).toBe(x.repeat(n));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64());
});

fuzz("padStart/padEnd match native", (a: u32, b: u32, c: u32): bool => {
  const x = pick(a);
  const pad = pickNeedle(b); // always non-empty
  const len = <i32>(c % 40); // 0..39
  expect(vstring.padStart(x, len, pad)).toBe(x.padStart(len, pad));
  expect(vstring.padEnd(x, len, pad)).toBe(x.padEnd(len, pad));
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("startsWith/endsWith match native", (a: u32, b: u32, c: u32): bool => {
  const s = pick(a);
  const probe = pick(b);
  const pos = idx(c, s.length);
  expect(vstring.startsWith(s, probe, pos)).toBe(s.startsWith(probe, pos));
  expect(vstring.endsWith(s, probe, pos)).toBe(s.endsWith(probe, pos));
  // a vstring needle must agree with the string needle
  expect(vstring.startsWith(s, vstring.from(probe), pos)).toBe(
    s.startsWith(probe, pos),
  );
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz(
  "indexOf with a vstring needle == string needle",
  (a: u32, b: u32): bool => {
    const s = pick(a);
    const needle = pickNeedle(b);
    expect(vstring.indexOf(s, vstring.from(needle))).toBe(s.indexOf(needle));
    expect(vstring.includes(s, vstring.from(needle))).toBe(s.includes(needle));
    return true;
  },
).generate((seed: FuzzSeed, run: (a: u32, b: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64());
});

// Trusted references built from indexOf/slice/concat. Native `String#replace*`
// is unreliable for longer replacements in this asc version (it can emit NUL
// bytes / corrupt the heap), so it can't be the oracle here.
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
    expect(vstring.replace(s, search, repl)).toBe(refReplace(s, search, repl));
    expect(vstring.replaceAll(s, search, repl)).toBe(
      refReplaceAll(s, search, repl),
    );
    return true;
  },
).generate((seed: FuzzSeed, run: (a: u32, b: u32, c: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64(), <u32>seed.u64());
});

fuzz("[] operator matches charCodeAt", (a: u32, b: u32): bool => {
  const s = pick(a);
  const v = vstring.from(s);
  const i = idx(b, s.length);
  const want = <u32>i < <u32>s.length ? s.charCodeAt(i) : -1;
  expect(v[i]).toBe(want);
  return true;
}).generate((seed: FuzzSeed, run: (a: u32, b: u32) => bool): void => {
  run(<u32>seed.u64(), <u32>seed.u64());
});
