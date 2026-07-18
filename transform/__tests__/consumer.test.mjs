import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const scratch = mkdtempSync(path.join(tmpdir(), "as-str-consumer-"));

function run(command, args, cwd = scratch) {
  const env = { ...process.env };
  // `npm publish --dry-run` exports this setting to lifecycle scripts. The
  // consumer fixture must still create its nested tarball to test installation.
  delete env.npm_config_dry_run;
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

try {
  const packed = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch],
    repo,
  );
  const packResult = JSON.parse(packed.stdout)[0];
  const tarball = path.join(scratch, packResult.filename);
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    tarball,
  ]);
  const input = path.join(scratch, "index.ts");
  writeFileSync(
    input,
    'export function check(): i32 { const part = "abcdef".slice(1, 4); return part.length; }\n',
  );
  const cli = path.join(scratch, "node_modules/as-str/bin/as-strc.js");
  const wasm = path.join(scratch, "consumer.wasm");
  run(process.execPath, [cli, input, "--outFile", wasm]);
  const module = await WebAssembly.instantiate(readFileSync(wasm), {
    env: {
      abort() {
        throw new Error("AssemblyScript abort");
      },
    },
  });
  assert.equal(module.instance.exports.check(), 3);
  assert.ok(
    readdirSync(path.join(scratch, "node_modules/as-str/transform/lib")).length,
  );
  console.log("clean consumer package test passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
