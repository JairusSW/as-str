import assert from "node:assert/strict";
import { TextDecoder } from "node:util";
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
const decoder = new TextDecoder("utf-8", { fatal: true });
const valid = (bytes) => {
  try {
    decoder.decode(bytes);
    return true;
  } catch {
    return false;
  }
};
const patterns = [
  [],
  [0],
  [0x7f],
  [0xc2, 0x80],
  [0xe0, 0xa0, 0x80],
  [0xed, 0x9f, 0xbf],
  [0xf0, 0x90, 0x80, 0x80],
  [0xf4, 0x8f, 0xbf, 0xbf],
  [0x80],
  [0xbf],
  [0xc0, 0x80],
  [0xc1, 0xbf],
  [0xc2],
  [0xe0, 0x9f, 0xbf],
  [0xed, 0xa0, 0x80],
  [0xf0, 0x8f, 0xbf, 0xbf],
  [0xf4, 0x90, 0x80, 0x80],
  [0xf5, 0x80, 0x80, 0x80],
  [0xff],
  [0xe2, 0x82],
  [0xf0, 0x90, 0x80],
];
const cases = [];
for (const pattern of patterns)
  for (let prefix = 0; prefix < 145; prefix++)
    for (const suffix of [0, 1, 7, 16, 65])
      cases.push(
        Uint8Array.from([
          ...Array(prefix).fill(65),
          ...pattern,
          ...Array(suffix).fill(66),
        ]),
      );
let seed = 0x55544638;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
for (let sample = 0; sample < 20000; sample++) {
  if (sample % 3 === 0) {
    const points = [];
    for (let i = 0; i < sample % 65; i++) {
      let cp = next() % 0x110000;
      if (cp >= 0xd800 && cp <= 0xdfff) cp = 65;
      points.push(cp);
    }
    const bytes = Buffer.from(String.fromCodePoint(...points));
    if (sample % 6 === 0 && bytes.length)
      bytes[next() % bytes.length] = next() & 255;
    cases.push(bytes);
  } else
    cases.push(
      Uint8Array.from({ length: sample % 257 }, () =>
        sample % 3 === 1 ? next() & 255 : next() & 127,
      ),
    );
}
const expected = cases.map(valid);
for (const simd of [false, true]) {
  const file = path.join(repo, `build/validation-oracle-${simd}.wasm`);
  const build = spawnSync(
    process.execPath,
    [
      "node_modules/assemblyscript/bin/asc.js",
      "assembly/__tests__/fixtures/validation-probe.ts",
      "-O3",
      "--noAssert",
      "--exportRuntime",
      "--enable",
      "bulk-memory",
      simd ? "--enable" : "--disable",
      "simd",
      "-o",
      file,
    ],
    { cwd: repo, encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const module = await WebAssembly.compile(readFileSync(file));
  const { exports } = await instantiateRuntime(module);
  for (let index = 0; index < cases.length; index++) {
    const bytes = cases[index];
    const pointer = exports.__new(bytes.length, 1);
    new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
    assert.equal(
      Boolean(exports.validate(pointer)),
      expected[index],
      `SIMD=${simd}, case=${index}, bytes=${Buffer.from(bytes).toString("hex")}`,
    );
  }
  for (const pattern of patterns) {
    const bytes = Uint8Array.from(pattern),
      runtime = await instantiateRuntime(module);
    const pointer = runtime.exports.__new(bytes.length, 1);
    new Uint8Array(runtime.exports.memory.buffer, pointer, bytes.length).set(
      bytes,
    );
    if (valid(bytes)) assert.equal(runtime.exports.checked(pointer), 1);
    else assert.throws(() => runtime.exports.checked(pointer), /invalid UTF-8/);
  }
}
console.log(
  `${cases.length} strict UTF-8 cases matched TextDecoder in SWAR/SIMD; checked-constructor cases passed`,
);
