#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const require = createRequire(import.meta.url);
const asc = require.resolve("assemblyscript/bin/asc.js");
const transform = fileURLToPath(
  new URL("../transform/lib/index.js", import.meta.url),
);

function withoutAsStrTransform(args: string[]): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (
      args[index] === "--transform" &&
      (args[index + 1] === "as-str" || args[index + 1] === "as-str/transform")
    ) {
      index++;
      continue;
    }
    filtered.push(args[index]);
  }
  return filtered;
}

function run(
  args: string[],
  env: Record<string, string>,
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [asc, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

const args = withoutAsStrTransform(process.argv.slice(2));
if (
  args.includes("--help") ||
  args.includes("-h") ||
  args.includes("--version")
) {
  const result = run(args, {});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const scratch = mkdtempSync(path.join(tmpdir(), "as-strc-"));
  const manifest = path.join(scratch, "manifest.json");

  try {
    const analysis = run([...args, "--transform", transform, "--noEmit"], {
      AS_STR_ANALYZE_ONLY: "0",
      AS_STR_MANIFEST_OUT: manifest,
      AS_STR_OPTIMIZE: "1",
    });
    if (analysis.error) throw analysis.error;
    if (analysis.status !== 0) {
      process.exitCode = analysis.status ?? 1;
    } else {
      const compilation = run([...args, "--transform", transform], {
        AS_STR_ANALYZE_ONLY: "0",
        AS_STR_MANIFEST_IN: manifest,
        AS_STR_OPTIMIZE: process.env["AS_STR_OPTIMIZE"] ?? "1",
      });
      if (compilation.error) throw compilation.error;
      process.exitCode = compilation.status ?? 1;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
