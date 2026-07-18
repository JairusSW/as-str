import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const asc = path.join(repo, "node_modules/assemblyscript/bin/asc.js");
const transform = path.join(repo, "transform/lib/index.js");

export function compileFixture(name, { optimize, suffix, extra = [] }) {
  const input = path.join(repo, `transform/__tests__/fixtures/${name}.ts`);
  const base = path.join(repo, "build", `${name}-${suffix}`);
  const wasm = `${base}.wasm`;
  const watPath = `${base}.wat`;
  const result = spawnSync(
    process.execPath,
    [
      asc,
      input,
      "--transform",
      transform,
      "--outFile",
      wasm,
      "--textFile",
      watPath,
      ...extra,
    ],
    {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        AS_STR_OPTIMIZE: optimize ? "1" : "0",
        STR_AS_DEBUG: optimize ? "1" : "0",
      },
    },
  );
  assert.equal(
    result.status,
    0,
    `asc failed for ${name}/${suffix}:\n${result.stdout}\n${result.stderr}`,
  );
  return {
    output: result.stdout + result.stderr,
    wasm,
    wat: readFileSync(watPath, "utf8"),
  };
}

export async function instantiate(filename) {
  return WebAssembly.instantiate(readFileSync(filename), {
    env: {
      abort() {
        throw new Error("AssemblyScript abort");
      },
    },
  });
}
