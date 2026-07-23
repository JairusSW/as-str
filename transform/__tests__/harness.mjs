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
const transforms = {
  global: path.join(repo, "transform/lib/index.js"),
  auto: path.join(repo, "transform/lib/auto.js"),
  single: path.join(repo, "transform/lib/single.js"),
};

export function compileFixture(
  name,
  { mode = "auto", suffix = mode, extra = [], debug = mode !== "global" } = {},
) {
  const transform = transforms[mode];
  assert.ok(transform, `unknown transform mode: ${mode}`);
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
        STR_AS_DEBUG: debug ? "1" : "0",
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

export function functionBody(wat, name) {
  const start = wat.indexOf(`(func $${name}`);
  assert.notEqual(start, -1, `missing WAT function ${name}`);
  const next = wat.indexOf("\n (func $", start + 1);
  return wat.slice(start, next < 0 ? wat.length : next);
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
