import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createCorpus, reference } from "./fixtures/payload-corpus.mjs";
import { instantiateRuntime } from "./lib/wasm-runtime.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i += 2) {
  assert.ok(
    ["--out", "--baseline", "--samples", "--filter", "--corpus"].includes(
      args[i],
    ),
    `unknown option: ${args[i]}`,
  );
  assert.ok(
    args[i + 1] !== undefined && !args[i + 1].startsWith("--"),
    `missing value for ${args[i]}`,
  );
  opts[args[i]] = args[i + 1];
}
const out = path.resolve(
  opts["--out"] ?? path.join(repo, "build/payload-performance"),
);
const baseline = opts["--baseline"] ? path.resolve(opts["--baseline"]) : null;
const samples = Number(opts["--samples"] ?? 7);
assert.ok(Number.isInteger(samples) && samples > 0);
mkdirSync(out, { recursive: true });
if (baseline)
  assert.notEqual(
    realpathSync(out),
    realpathSync(baseline),
    "preserve the baseline",
  );
const corpus = opts["--corpus"]
  ? JSON.parse(readFileSync(opts["--corpus"], "utf8"))
  : createCorpus(repo);
const selected = corpus.filter((c) => c.name.includes(opts["--filter"] ?? ""));
assert.ok(selected.length > 0, "no matching workloads");
const corpusJSON = JSON.stringify(corpus, null, 2) + "\n";
writeFileSync(path.join(out, "corpus.json"), corpusJSON);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

async function createInstance(module, records) {
  const runtime = await instantiateRuntime(module);
  const { exports } = runtime;
  for (const record of records) {
    const pointer = exports.__new(record.length * 2, 2);
    const units = new Uint16Array(
      exports.memory.buffer,
      pointer,
      record.length,
    );
    for (let i = 0; i < record.length; i++) units[i] = record.charCodeAt(i);
    exports.addRecord(pointer);
  }
  exports.__collect();
  return runtime;
}

function verify(exports, workload, encoding, expected) {
  for (let i = 0; i < expected.length; i++) {
    assert.equal(
      exports[`one${encoding}`](workload.kind, i),
      expected[i],
      `${workload.name}/utf${encoding}, record ${i}`,
    );
  }
}

function expectedSum(values, count) {
  const cycles = Math.floor(count / values.length);
  return (
    (cycles * values.reduce((a, b) => a + b, 0) +
      values.slice(0, count % values.length).reduce((a, b) => a + b, 0)) |
    0
  );
}

const rows = [];
const builds = [];
for (const simd of [false, true]) {
  const mode = simd ? "simd" : "swar";
  const versions = baseline ? ["baseline", "candidate"] : ["candidate"];
  const modules = {};
  for (const traced of [false, true]) {
    const file = `${mode}${traced ? "-allocations" : ""}.wasm`;
    const compiled = spawnSync(
      process.execPath,
      [
        "node_modules/assemblyscript/bin/asc.js",
        "scripts/fixtures/payload-performance.ts",
        "-O3",
        "--noAssert",
        "--exportRuntime",
        "--enable",
        "bulk-memory",
        simd ? "--enable" : "--disable",
        "simd",
        ...(traced ? ["--use", "ASC_RTRACE=1"] : []),
        "-o",
        path.join(out, file),
      ],
      { cwd: repo, encoding: "utf8" },
    );
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    for (const version of versions) {
      const bytes = readFileSync(
        path.join(version === "baseline" ? baseline : out, file),
      );
      builds.push({
        mode,
        version,
        traced,
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
      modules[`${version}/${traced}`] = await WebAssembly.compile(bytes);
    }
  }
  for (const workload of selected) {
    for (const encoding of [16, 8]) {
      const expected = workload.records.map((text) =>
        reference(workload.kind, text, encoding),
      );
      const method =
        [
          "headers",
          "routes",
          "logs",
          "tsv",
          "normalize",
          "source",
          "json",
          "encoding",
          "extract",
          "sizing",
        ][workload.kind] +
        encoding +
        (workload.kind == 4 ? "Work" : "");
      const calibration = await createInstance(
        modules["candidate/false"],
        workload.records,
      );
      verify(calibration.exports, workload, encoding, expected);
      const trialCount = Math.max(1000, workload.records.length * 4);
      calibration.exports[method](trialCount);
      calibration.exports.__collect();
      const start = performance.now();
      calibration.exports[method](trialCount);
      const elapsed = Math.max(performance.now() - start, 0.1);
      const count = Math.max(
        workload.records.length,
        Math.min(1000000, Math.ceil((trialCount * 35) / elapsed)),
      );
      const expectedTotal = expectedSum(expected, count);
      const times = { baseline: [], candidate: [] };
      const allocations = {};
      for (const version of versions) {
        const traced = await createInstance(
          modules[`${version}/true`],
          workload.records,
        );
        verify(traced.exports, workload, encoding, expected);
        traced.exports.__collect();
        traced.resetCounts();
        assert.equal(
          traced.exports[method](workload.records.length),
          expectedSum(expected, workload.records.length),
        );
        allocations[version] = {
          records: workload.records.length,
          ...traced.counts(),
        };
      }
      for (let sample = 0; sample < samples; sample++) {
        for (const version of sample % 2 ? [...versions].reverse() : versions) {
          const { exports } = await createInstance(
            modules[`${version}/false`],
            workload.records,
          );
          verify(exports, workload, encoding, expected);
          exports[method](trialCount);
          exports.__collect();
          const before = performance.now();
          const actual = exports[method](count);
          times[version].push(performance.now() - before);
          assert.equal(
            actual,
            expectedTotal,
            `${mode}/${version}/${workload.name}/utf${encoding}`,
          );
        }
      }
      const candidateMs = median(times.candidate);
      const row = {
        mode,
        name: `${workload.name}/utf${encoding}`,
        records: workload.records.length,
        minBytes: Math.min(
          ...workload.records.map((s) => Buffer.byteLength(s)),
        ),
        maxBytes: Math.max(
          ...workload.records.map((s) => Buffer.byteLength(s)),
        ),
        count,
        candidateMs,
        candidateSamplesMs: times.candidate,
        allocations,
        ...(baseline
          ? {
              baselineMs: median(times.baseline),
              baselineSamplesMs: times.baseline,
              speedup: median(times.baseline) / candidateMs,
            }
          : {}),
      };
      rows.push(row);
      console.log(
        JSON.stringify({
          mode,
          name: row.name,
          candidateMs: +candidateMs.toFixed(3),
          speedup: row.speedup ? +row.speedup.toFixed(2) : undefined,
          allocations,
        }),
      );
    }
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
      baseline,
      corpusSha256: sha256(corpusJSON),
      builds,
      rows,
    },
    null,
    2,
  ) + "\n",
);
