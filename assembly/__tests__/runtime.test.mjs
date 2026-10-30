import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
mkdirSync(path.join(repo, "build"), { recursive: true });

for (const simd of [false, true]) {
  const wasm = path.join(repo, `build/runtime-safety-${simd}.wasm`);
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/assemblyscript/bin/asc.js",
      "assembly/__tests__/fixtures/runtime.ts",
      "-o",
      wasm,
      "-O3",
      "--noAssert",
      "--enable",
      "bulk-memory",
      simd ? "--enable" : "--disable",
      "simd",
      // A broken size guard must not grow memory without bound in the test.
      "--maximumMemory",
      "256",
    ],
    { cwd: repo, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const module = await WebAssembly.compile(readFileSync(wasm));
  for (const [name, message] of [
    ["nativeAtEmpty", /Index out of range/],
    ["nativeAtLengthOverflow", /Index out of range/],
    ["repeat16Overflow", /Invalid length/],
    ["repeat8Overflow", /Invalid length/],
    ["replaceAll16Overflow", /Invalid length/],
    ["replaceAll8Overflow", /Invalid length/],
    ["replaceAll16EmptyOverflow", /Invalid length/],
    ["replaceAll8EmptyOverflow", /Invalid length/],
    ["checkedUtf8Invalid", /invalid UTF-8/],
    ["checkedUtf8Valid", null],
  ]) {
    // A trapping Wasm call can leave the runtime stack unwound; isolate cases.
    const instance = await WebAssembly.instantiate(module, {
      env: {
        abort(pointer) {
          const memory = instance.exports.memory.buffer;
          const bytes = new DataView(memory).getUint32(pointer - 4, true);
          const units = new Uint16Array(memory, pointer, bytes / 2);
          throw new Error(String.fromCharCode(...units));
        },
      },
    });
    if (message) {
      assert.throws(
        () => instance.exports[name](),
        message,
        `${name}, SIMD=${simd}`,
      );
    } else {
      assert.equal(instance.exports[name](), 1);
    }
  }
}
console.log("runtime allocation and checked UTF-8 regressions passed");
