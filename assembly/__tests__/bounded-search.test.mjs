import assert from "node:assert/strict";
import {
  compileFixture,
  instantiate,
} from "../../transform/__tests__/harness.mjs";
let seed = 0x53656172;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const inputs = [];
for (let i = 0; i < 2000; i++) {
  const unit = () =>
    String.fromCharCode([0, 97, 98, 233, 0xffff][random() % 5]);
  let hay = "",
    needle = "";
  for (let j = random() % 200; j > 0; j--) hay += unit();
  for (let j = 1 + (random() % 60); j > 0; j--) needle += unit();
  if (i % 3 && hay.length) needle = hay.slice(random() % hay.length) || "a";
  inputs.push([hay, needle]);
}
for (const n of [256, 257, 511, 1024, 4096, 8192]) {
  for (const pattern of ["a", "ab", "abc", "aab", "éa", "\uffffb"]) {
    const needle = pattern.repeat(n).slice(0, n);
    const hay = pattern.repeat(n * 2);
    inputs.push(
      [hay, needle],
      [hay, needle.slice(0, n / 2) + "c" + needle.slice(n / 2 + 1)],
    );
    inputs.push(["x".repeat(n) + needle + "x".repeat(n) + needle, needle]);
  }
}
for (const simd of [false, true]) {
  const compiled = compileFixture("review-search", {
    mode: "global",
    suffix: `search-${simd}`,
    extra: ["-O3", "--exportRuntime", ...(simd ? ["--enable", "simd"] : [])],
  });
  const {
    instance: { exports },
  } = await instantiate(compiled.wasm);
  function string(text) {
    const ptr = exports.__pin(exports.__new(text.length * 2, 2));
    const mem = new Uint16Array(exports.memory.buffer, ptr, text.length);
    for (let i = 0; i < text.length; i++) mem[i] = text.charCodeAt(i);
    return ptr;
  }
  for (let i = 0; i < inputs.length; i++) {
    const [hay, needle] = inputs[i],
      hp = string(hay),
      np = string(needle);
    const hb = Buffer.from(hay),
      nb = Buffer.from(needle);
    try {
      for (const from of [
        -1,
        0,
        1,
        Math.floor(hay.length / 2),
        hay.length,
        2147483647,
      ]) {
        for (const reverse of [false, true]) {
          const position = Math.max(from, 0);
          const expected16 = reverse
            ? hay.lastIndexOf(needle, position)
            : hay.indexOf(needle, position);
          const expected8 = reverse
            ? hb.lastIndexOf(nb, Math.min(position, hb.length - nb.length))
            : hb.indexOf(nb, position);
          for (const fn of ["forced", "units"])
            assert.equal(
              exports[fn](hp, np, from, reverse),
              expected16,
              `${fn}, SIMD=${simd}, case=${i}, from=${from}, reverse=${reverse}`,
            );
          // Buffer negative offsets count from the end; a too-long needle cannot match.
          assert.equal(
            exports.bytes(hp, np, from, reverse),
            nb.length > hb.length ? -1 : expected8,
            `bytes, SIMD=${simd}, case=${i}, from=${from}, reverse=${reverse}`,
          );
        }
      }
    } finally {
      exports.__unpin(hp);
      exports.__unpin(np);
    }
  }
  console.log(
    `${inputs.length} bounded-search oracle cases passed, SIMD=${simd}`,
  );
}
