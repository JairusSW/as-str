import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
const scratch = mkdtempSync(path.join(tmpdir(), "as-str-pnpm-consumer-"));
const pnpm = path.join(repo, "node_modules/pnpm/bin/pnpm.cjs");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

async function exportedResult(wasm, name) {
  const { instance } = await WebAssembly.instantiate(readFileSync(wasm), {
    env: {
      abort() {
        throw new Error("AssemblyScript abort");
      },
    },
  });
  return instance.exports[name]();
}

try {
  const packed = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch],
    repo,
  );
  const tarball = path.join(scratch, JSON.parse(packed.stdout)[0].filename);

  const isolated = path.join(scratch, "isolated");
  mkdirSync(isolated);
  writeFileSync(
    path.join(isolated, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: {
        "as-str": `file:${tarball}`,
        assemblyscript: "0.28.20",
      },
    }),
  );
  writeFileSync(
    path.join(isolated, "index.ts"),
    [
      'import { str } from "as-str";',
      "export function check(): i32 {",
      '  return str("abc").slice(1).length;',
      "}",
      "",
    ].join("\n"),
  );
  run(process.execPath, [pnpm, "install", "--ignore-scripts"], isolated);
  const isolatedWasm = path.join(isolated, "index.wasm");
  run(
    process.execPath,
    ["node_modules/assemblyscript/bin/asc.js", "index.ts", "-o", isolatedWasm],
    isolated,
  );
  assert.equal(await exportedResult(isolatedWasm, "check"), 2);

  const workspace = path.join(scratch, "workspace");
  const runtimeCopy = path.join(workspace, "packages", "runtime-copy");
  const consumer = path.join(workspace, "packages", "consumer");
  mkdirSync(runtimeCopy, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  run(
    "tar",
    ["-xzf", tarball, "--strip-components=1", "-C", runtimeCopy],
    workspace,
  );
  writeFileSync(
    path.join(workspace, "pnpm-workspace.yaml"),
    'packages:\n  - "packages/*"\n',
  );
  writeFileSync(
    path.join(workspace, "package.json"),
    JSON.stringify({ private: true }),
  );
  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({
      name: "consumer",
      private: true,
      dependencies: {
        "as-str": "workspace:*",
        assemblyscript: "0.28.20",
      },
    }),
  );
  writeFileSync(
    path.join(consumer, "helper.ts"),
    [
      'import { str } from "as-str";',
      "export function measure(value: str): i32 {",
      "  return value.length;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(consumer, "entry.ts"),
    [
      'import { measure } from "./helper";',
      "export function check(): i32 {",
      '  return measure(str("abc"));',
      "}",
      "",
    ].join("\n"),
  );
  run(process.execPath, [pnpm, "install", "--ignore-scripts"], workspace);
  const workspaceWasm = path.join(consumer, "entry.wasm");
  run(
    process.execPath,
    [
      "node_modules/assemblyscript/bin/asc.js",
      "entry.ts",
      "--transform",
      "as-str/global",
      "-o",
      workspaceWasm,
    ],
    consumer,
  );
  assert.equal(await exportedResult(workspaceWasm, "check"), 3);

  console.log("pnpm isolated and workspace-link consumers passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
