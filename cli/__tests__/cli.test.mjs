import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const cli = path.join(repo, "bin/as-strc.js");
const before = new Set(
  readdirSync(tmpdir()).filter((name) => name.startsWith("as-strc-")),
);

const version = spawnSync(process.execPath, [cli, "--version"], {
  cwd: repo,
  encoding: "utf8",
});
assert.equal(version.status, 0, version.stdout + version.stderr);
assert.match(version.stdout + version.stderr, /Version 0\.28\./);

const failure = spawnSync(
  process.execPath,
  [cli, path.join(repo, "does-not-exist.ts"), "--noEmit"],
  { cwd: repo, encoding: "utf8" },
);
assert.notEqual(failure.status, 0);
const leaked = readdirSync(tmpdir()).filter(
  (name) => name.startsWith("as-strc-") && !before.has(name),
);
assert.deepEqual(
  leaked,
  [],
  `temporary directories leaked: ${leaked.join(", ")}`,
);

console.log("as-strc CLI tests passed");
