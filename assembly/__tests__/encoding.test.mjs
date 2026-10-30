import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { instantiateRuntime } from "../../scripts/lib/wasm-runtime.mjs";
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
mkdirSync(path.join(repo, "build"), { recursive: true });

// Independent WTF-8 oracle: unlike Buffer.from, preserve lone surrogates.
function encode(units) {
  const bytes = [];
  for (let i = 0; i < units.length; i++) {
    let c = units[i];
    if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      units[i + 1] >= 0xdc00 &&
      units[i + 1] <= 0xdfff
    )
      c = 0x10000 + ((c - 0xd800) << 10) + (units[++i] - 0xdc00);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000)
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63),
      );
  }
  return bytes;
}
let seed = 0x50524f50;
const boundaries = [
  0, 0x7f, 0x80, 0x7ff, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff,
];
const inputs = [
  [0xd800, 97, 0xdc00, 97, 97, 97, 97, 97],
  [0xdc00, 0xd800, 97, 97, 97, 97, 97, 97],
];
for (let sample = 0; sample < 2000; sample++) {
  const units = [];
  for (let i = 0; i < sample % 130; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    units.push(
      sample % 3 === 0
        ? seed & 127
        : sample % 3 === 1
          ? boundaries[seed % boundaries.length]
          : seed >>> 16,
    );
  }
  inputs.push(units);
}
// Place paired and unpaired surrogates around every vector/chunk boundary.
for (const length of [
  7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129,
]) {
  for (const filler of [0x41, 0x80, 0x800]) {
    for (let high = 0; high < length; high++) {
      for (const delta of [-2, -1, 0, 1, 2, 7, 8, 31]) {
        const low = high + delta;
        if (low < 0 || low >= length) continue;
        const units = Array(length).fill(filler);
        units[high] = 0xdbff;
        units[low] = 0xdc00;
        inputs.push(units);
      }
    }
  }
}

for (const simd of [false, true]) {
  const wasm = path.join(repo, `build/encoding-oracle-${simd}.wasm`);
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/assemblyscript/bin/asc.js",
      "assembly/__tests__/fixtures/encoding-probe.ts",
      "-O3",
      "--noAssert",
      "--exportRuntime",
      "--enable",
      "bulk-memory",
      simd ? "--enable" : "--disable",
      "simd",
      "-o",
      wasm,
    ],
    { cwd: repo, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const module = await WebAssembly.compile(readFileSync(wasm));
  const { exports } = await instantiateRuntime(module);
  for (let sample = 0; sample < inputs.length; sample++) {
    const units = inputs[sample],
      expected = encode(units);
    const pointer = exports.__pin(exports.__new(units.length * 2, 2));
    new Uint16Array(exports.memory.buffer, pointer, units.length).set(units);
    try {
      for (const method of ["encodedLength", "encodedViewLength"])
        assert.equal(
          exports[method](pointer),
          expected.length,
          `${method}, SIMD=${simd}, sample=${sample}`,
        );
      for (const method of ["encode", "encodeNative", "encodeView"]) {
        const buffer = exports[method](pointer);
        const length = new DataView(exports.memory.buffer).getUint32(
          buffer - 4,
          true,
        );
        assert.deepEqual(
          [...new Uint8Array(exports.memory.buffer, buffer, length)],
          expected,
          `${method}, SIMD=${simd}, sample=${sample}`,
        );
      }
      const nul = units.indexOf(0);
      const terminated = [...encode(nul < 0 ? units : units.slice(0, nul)), 0];
      assert.equal(
        exports.terminatedLength(pointer),
        terminated.length,
        `terminatedLength, SIMD=${simd}, sample=${sample}`,
      );
      for (const [method, bytes] of [
        ["encodeTerminated", terminated],
        ["encodeReplacement", [...Buffer.from(String.fromCharCode(...units))]],
      ]) {
        const result = exports[method](pointer);
        const length = new DataView(exports.memory.buffer).getUint32(
          result - 4,
          true,
        );
        assert.deepEqual(
          [...new Uint8Array(exports.memory.buffer, result, length)],
          bytes,
          `${method}, SIMD=${simd}, sample=${sample}`,
        );
      }
      for (const method of ["decode", "decodeView", "toUtf16"]) {
        const result = exports[method](pointer);
        const bytes = new DataView(exports.memory.buffer).getUint32(
          result - 4,
          true,
        );
        assert.equal(bytes % 2, 0, `${method}: UTF-16 size must be even`);
        assert.deepEqual(
          [...new Uint16Array(exports.memory.buffer, result, bytes / 2)],
          units,
          `${method}, SIMD=${simd}, sample=${sample}`,
        );
      }
    } finally {
      exports.__unpin(pointer);
    }
  }
  for (const units of [
    ...inputs.slice(0, 32),
    [0xd800, 0xdc00],
    [0xdc00],
    [0x41, 0xd800],
  ]) {
    const { exports: strict } = await instantiateRuntime(module);
    const pointer = strict.__new(units.length * 2, 2);
    new Uint16Array(strict.memory.buffer, pointer, units.length).set(units);
    const text = String.fromCharCode(...units);
    const wellFormed = [...text].every((c) => {
      const cp = c.codePointAt(0);
      return cp < 0xd800 || cp > 0xdfff;
    });
    if (!wellFormed)
      assert.throws(() => strict.encodeStrict(pointer), /unpaired surrogate/);
    else {
      const result = strict.encodeStrict(pointer);
      const length = new DataView(strict.memory.buffer).getUint32(
        result - 4,
        true,
      );
      assert.deepEqual(
        [...new Uint8Array(strict.memory.buffer, result, length)],
        encode(units),
      );
    }
  }
}
console.log(
  `${inputs.length} WTF-8 sizing/encoding/round-trip/flag cases passed in SWAR and SIMD builds`,
);
