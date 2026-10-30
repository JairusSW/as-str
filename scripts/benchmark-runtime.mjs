import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

// Save a baseline with --out <directory>, then compare with --baseline <directory>.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options = ["--out", "--baseline", "--samples", "--filter"];
for (let i = 0; i < args.length; i += 2) {
  assert.ok(options.includes(args[i]), `unknown option: ${args[i]}`);
  assert.ok(
    args[i + 1] !== undefined && !args[i + 1].startsWith("--"),
    `missing value for ${args[i]}`,
  );
}
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const out = path.resolve(
  option("--out", path.join(repo, "build/runtime-performance")),
);
const baseline = option("--baseline", null);
if (baseline)
  assert.notEqual(out, path.resolve(baseline), "preserve the baseline");
const samples = Number(option("--samples", "7"));
const filter = option("--filter", "");
assert.ok(Number.isInteger(samples) && samples > 0);
mkdirSync(out, { recursive: true });
if (baseline)
  assert.notEqual(
    realpathSync(out),
    realpathSync(baseline),
    "preserve the baseline",
  );
const cases = [];
const searchScenarios = [
  "front",
  "missing",
  "end",
  "word",
  "dense-prefix",
  "",
  "",
  "false-prefix",
  "two-false-prefixes",
  "dense-ends",
  "dense-suffix",
  "clustered-prefix",
];
for (const size of [8, 32, 256, 4096]) {
  for (const scenario of [0, 1, 2, 3, 4, 7, 8, 9, 10, 11]) {
    for (let kind = 0; kind < 4; kind++) {
      cases.push({
        name: `${["last16", "last8", "first16", "first8"][kind]}/${searchScenarios[scenario]}/${size}`,
        setup: [size, scenario],
        method: ["last16", "last8", "first16", "first8"][kind],
        args: [],
        iterations: Math.max(2000, Math.floor(4000000 / size)),
      });
    }
  }
}
for (const size of [0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 32, 128, 256, 257]) {
  for (const [label, mismatch] of [
    ["equal", -1],
    ["first", 0],
    ["middle", size >> 1],
    ["last", Math.max(0, size - 1)],
  ]) {
    for (const method of ["equal16", "equal8"]) {
      cases.push({
        name: `${method}/${label}/${size}`,
        setupMethod: "setupEquality",
        setup: [size, mismatch],
        method,
        args: [],
        iterations: 200000,
      });
    }
  }
}
for (const count of [1, 2, 3, 8, 32, 256, 4096]) {
  for (let kind = 0; kind < 4; kind++) {
    cases.push({
      name: `${["repeat16", "repeat8", "padEnd16", "padStart8"][kind]}/${count}`,
      setup: [2, 5],
      method: "fill",
      args: [kind, count],
      iterations: Math.max(2000, Math.min(100000, Math.floor(1000000 / count))),
    });
  }
}
for (const size of [8, 256, 4096]) {
  for (let kind = 0; kind < 4; kind++) {
    cases.push({
      name: `sliceChars/${["prefix", "suffix", "negative", "finite-end"][kind]}/${size}`,
      setup: [size, 6],
      method: "sliceChars",
      args: [kind],
      iterations: Math.max(2000, Math.floor(1000000 / size)),
    });
  }
}
const selectedCases = cases.filter((item) => item.name.includes(filter));
assert.ok(selectedCases.length > 0, `no workloads match: ${filter}`);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const rows = [];
const builds = [];
for (const simd of [false, true]) {
  const mode = simd ? "simd" : "swar";
  const filename = `${mode}.wasm`;
  const compiled = spawnSync(
    process.execPath,
    [
      "node_modules/assemblyscript/bin/asc.js",
      "scripts/fixtures/runtime-performance.ts",
      "-O3",
      "--noAssert",
      "--enable",
      "bulk-memory",
      simd ? "--enable" : "--disable",
      "simd",
      "-o",
      path.join(out, filename),
    ],
    { cwd: repo, encoding: "utf8" },
  );
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const versions = baseline ? ["baseline", "candidate"] : ["candidate"];
  const modules = {};
  for (const version of versions) {
    const bytes = readFileSync(
      path.join(version === "baseline" ? baseline : out, filename),
    );
    builds.push({
      mode,
      version,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    modules[version] = await WebAssembly.compile(bytes);
  }
  for (const scenario of selectedCases) {
    const times = { baseline: [], candidate: [] };
    let expected;
    for (let sample = 0; sample < samples; sample++) {
      for (const version of sample % 2 ? [...versions].reverse() : versions) {
        const instance = await WebAssembly.instantiate(modules[version], {
          env: {
            abort() {
              throw new Error("AssemblyScript abort");
            },
          },
        });
        const exports = instance.exports;
        exports[scenario.setupMethod ?? "setup"](...scenario.setup);
        for (let warm = 0; warm < 5; warm++)
          exports[scenario.method](...scenario.args, 1000);
        const start = performance.now();
        const actual = exports[scenario.method](
          ...scenario.args,
          scenario.iterations,
        );
        times[version].push(performance.now() - start);
        if (expected === undefined) expected = actual;
        assert.equal(
          actual,
          expected,
          `${mode}/${scenario.name} changed output`,
        );
      }
    }
    const candidateMs = median(times.candidate);
    const row = {
      mode,
      name: scenario.name,
      iterations: scenario.iterations,
      candidateMs: +candidateMs.toFixed(3),
      candidateSamplesMs: times.candidate,
    };
    if (baseline) {
      row.baselineMs = +median(times.baseline).toFixed(3);
      row.speedup = +(median(times.baseline) / candidateMs).toFixed(2);
      row.baselineSamplesMs = times.baseline;
    }
    rows.push(row);
    console.log(
      JSON.stringify({
        mode,
        name: row.name,
        baselineMs: row.baselineMs,
        candidateMs: row.candidateMs,
        speedup: row.speedup,
      }),
    );
  }
}
writeFileSync(
  path.join(out, "results.json"),
  JSON.stringify(
    {
      node: process.version,
      v8: process.versions.v8,
      arch: process.arch,
      platform: process.platform,
      samples,
      builds,
      baseline: baseline ? path.resolve(baseline) : null,
      rows,
    },
    null,
    2,
  ) + "\n",
);
