import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instantiateRuntime } from "../../scripts/lib/wasm-runtime.mjs";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
mkdirSync(path.join(repo, "build"), { recursive: true });

// Encode independently, preserving unpaired UTF-16 surrogates as WTF-8.
function encode(text) {
  const out = [];
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return Buffer.from(out);
}
function reference(hay, needle, from) {
  const same = (at) =>
    at >= 0 &&
    at + needle.length <= hay.length &&
    needle.every((byte, i) => hay[at + i] === byte);
  let first = needle.length ? -1 : 0;
  if (needle.length)
    for (let i = Math.max(from, 0); i <= hay.length - needle.length; i++) {
      if (same(i)) {
        first = i;
        break;
      }
    }
  let last = needle.length ? -1 : hay.length;
  if (needle.length)
    for (
      let i = Math.min(Math.max(from, 0), hay.length - needle.length);
      i >= 0;
      i--
    ) {
      if (same(i)) {
        last = i;
        break;
      }
    }
  const at = Math.min(Math.max(from, 0), hay.length);
  return [
    first,
    last,
    Number(same(at)),
    Number(same(at - needle.length)),
    Number(hay.length === needle.length && same(0)),
  ];
}
let seed = 0x53454152;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const lengths = [
  0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255,
  256, 257, 1023, 1024, 1025, 2049,
];
const units = [
  0, 1, 65, 66, 0x7f, 0x80, 0x7ff, 0x800, 0xd800, 0xdbff, 0xdc00, 0xdfff,
  0xffff,
];
const inputs = [];
for (let sample = 0; sample < 2400; sample++) {
  const length = lengths[sample % lengths.length];
  let text = "";
  for (let i = 0; i < sample % 70; i++)
    text += String.fromCharCode(
      sample % 3 ? units[random() % units.length] : 65 + (random() % 3),
    );
  const needle = encode(text);
  const hay = Buffer.alloc(length);
  for (let i = 0; i < length; i++)
    hay[i] = sample % 4 === 0 ? random() & 255 : 65 + (random() % 3);
  if (needle.length <= length && sample % 2) {
    const at = random() % (length - needle.length + 1);
    needle.copy(hay, at);
    if (sample % 7 === 0) needle.copy(hay, 0);
  }
  inputs.push({ hay, needle, text });
}
// Repeated prefixes exercise the native-needle fallback and wide byte filters.
for (const length of lengths)
  for (const text of [
    "",
    "A",
    "AA",
    "AB",
    "AAAAAB",
    "ABAAAA",
    "A".repeat(32) + "B",
    "A".repeat(64),
  ]) {
    const hay = Buffer.from("A".repeat(length));
    if (length) hay[Math.floor(length / 2)] = 66;
    inputs.push({ hay, needle: encode(text), text });
  }
const comparisonPairs = inputs.map(({ text }, i) => [
  text,
  inputs[(i + 1) % inputs.length].text,
]);
const endings = [
  "",
  "a",
  "b",
  "\u007f",
  "\u0080",
  "\ud7ff",
  "\ud800",
  "\udbff",
  "\udc00",
  "\udfff",
  "\ue000",
  "\uffff",
  "😀",
  "🌍",
  "\ud800a",
  "\ud800\udc00",
  "\udbff\udfff",
];
for (const length of [0, 1, 3, 4, 7, 8, 15, 16, 31, 32, 63, 64]) {
  const prefix = "a".repeat(length);
  for (const a of endings)
    for (const b of endings) comparisonPairs.push([prefix + a, prefix + b]);
}
for (const simd of [false, true]) {
  const filename = path.join(repo, `build/search-oracle-${simd}.wasm`);
  const built = spawnSync(
    process.execPath,
    [
      "node_modules/assemblyscript/bin/asc.js",
      "assembly/__tests__/fixtures/search-probe.ts",
      "-O3",
      "--noAssert",
      "--exportRuntime",
      "--enable",
      "bulk-memory",
      simd ? "--enable" : "--disable",
      "simd",
      "-o",
      filename,
    ],
    { cwd: repo, encoding: "utf8" },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const { exports } = await instantiateRuntime(
    await WebAssembly.compile(readFileSync(filename)),
  );
  function buffer(bytes) {
    const padded = Buffer.concat([
      Buffer.from([0x41, 0x42, 0x43]),
      bytes,
      Buffer.from([0x44, 0x45, 0x46, 0x47, 0x48]),
    ]);
    const pointer = exports.__pin(exports.__new(padded.length, 1));
    new Uint8Array(exports.memory.buffer, pointer, padded.length).set(padded);
    return pointer;
  }
  function string(text) {
    const pointer = exports.__pin(exports.__new(text.length * 2, 2));
    const memory = new Uint16Array(exports.memory.buffer, pointer, text.length);
    for (let i = 0; i < text.length; i++) memory[i] = text.charCodeAt(i);
    return pointer;
  }
  for (let sample = 0; sample < comparisonPairs.length; sample++) {
    const [left, right] = comparisonPairs[sample];
    const lp = string(left),
      rp = string(right);
    try {
      assert.equal(
        exports.nativeCompare(lp, rp),
        Math.sign(Buffer.compare(encode(left), encode(right))),
        `native ordering, SIMD=${simd}, sample=${sample}`,
      );
      assert.equal(
        exports.nativeCompare(lp, lp),
        0,
        `native identity, SIMD=${simd}, sample=${sample}`,
      );
    } finally {
      exports.__unpin(lp);
      exports.__unpin(rp);
    }
  }
  console.log(
    `${comparisonPairs.length} native WTF-8 ordering pairs passed, SIMD=${simd}`,
  );
  let comparisons = 0;
  for (let sample = 0; sample < inputs.length; sample++) {
    const { hay, needle, text } = inputs[sample];
    const hp = buffer(hay),
      np = buffer(needle);
    const tp = string(text);
    try {
      for (const from of [
        -2147483648,
        -1,
        0,
        1,
        7,
        16,
        Math.floor(hay.length / 2),
        hay.length - 1,
        hay.length,
        2147483647,
      ]) {
        const expected = reference(hay, needle, from);
        for (let variant = 0; variant < 3; variant++)
          for (const free of [0, 1])
            for (let op = 0; op < 5; op++) {
              assert.equal(
                exports.search(hp, tp, np, from, op, variant, free),
                expected[op],
                `SIMD=${simd}, sample=${sample}, from=${from}, op=${op}, variant=${variant}, free=${free}`,
              );
              comparisons++;
            }
      }
    } finally {
      exports.__unpin(hp);
      exports.__unpin(np);
      exports.__unpin(tp);
    }
  }
  console.log(
    `${comparisons} UTF-8 byte-search comparisons passed, SIMD=${simd}`,
  );
}
