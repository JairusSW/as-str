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
for (const simd of [false, true]) {
  const filename = path.join(
    repo,
    `build/native-needle-allocations-${simd}.wasm`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/assemblyscript/bin/asc.js",
      "assembly/__tests__/fixtures/native-needle.ts",
      "-O3",
      "--noAssert",
      "--exportRuntime",
      "--use",
      "ASC_RTRACE=1",
      "--enable",
      "bulk-memory",
      simd ? "--enable" : "--disable",
      "simd",
      "-o",
      filename,
    ],
    { cwd: repo, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const runtime = await instantiateRuntime(
    await WebAssembly.compile(readFileSync(filename)),
  );
  // Ensure tracing is live before asserting a zero allocation result.
  assert.ok(runtime.counts().allocs > 0);
  runtime.exports.__collect();
  runtime.resetCounts();
  assert.equal(runtime.exports.asciiQueries(), 1);
  assert.deepEqual(runtime.counts(), { allocs: 0, resizes: 0 }, `SIMD=${simd}`);
  for (const name of ["toStr8View", "fromStrView", "convertStrView"]) {
    runtime.exports.__collect();
    runtime.resetCounts();
    assert.equal(runtime.exports[name](), 12);
    // One owned UTF-8 buffer and one view, without a temporary UTF-16 string.
    assert.deepEqual(
      runtime.counts(),
      { allocs: 2, resizes: 0 },
      `${name}, SIMD=${simd}`,
    );
  }
  const text = "Résumé 日本語 😀";
  for (const [name, result, allocs] of [
    ["nativeMetadata", 3 * Buffer.byteLength(text) + 2 * text.length, 0],
    ["nativeEncode8", Buffer.byteLength(text), 1],
    ["nativeEncode16", 2 * text.length, 1],
  ]) {
    runtime.exports.__collect();
    runtime.resetCounts();
    assert.equal(runtime.exports[name](), result);
    assert.deepEqual(
      runtime.counts(),
      { allocs, resizes: 0 },
      `${name}, SIMD=${simd}`,
    );
  }
}
console.log(
  "native ASCII queries and metadata allocate no blocks; encoders allocate only their output buffer/view",
);
