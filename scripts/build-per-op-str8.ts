// per-op speedup chart for str8 - every native String operation vs its str8
// (UTF-8) counterpart over the same ~2 kb ASCII input. Same template as
// build-per-op.ts, but reads the `u8_*` suites and treats benches whose name
// starts with "str8." as the lib bar.
//
// Metric is speedup vs native (native = the 1× baseline bar). Reads
// build/logs/bench.simd.json (produced by scripts/build-charts.sh).
import fs from "node:fs";
import {
  createBarChart,
  generateChart,
  type BenchResult,
} from "./lib/bench-utils";
import { MODE_BARS } from "./lib/palette";

interface AsBenchEntry {
  suite: string;
  name: string;
  result: { point: number }; // per-op time, milliseconds
}
const SIMD: { benches: AsBenchEntry[] } = JSON.parse(
  fs.readFileSync("./build/logs/bench.simd.json", "utf-8"),
);

function ns(suite: string, isLib: boolean): number {
  const hit = SIMD.benches.find(
    (b) => b.suite === suite && b.name.startsWith("str8.") === isLib,
  );
  if (!hit) throw new Error(`no bench in suite "${suite}" (isLib=${isLib})`);
  return hit.result.point * 1e6;
}
const speedup = (suite: string): number => ns(suite, false) / ns(suite, true);

const bar = (mbps: number, description: string): BenchResult => ({
  language: "as",
  description,
  elapsed: 0,
  bytes: 0,
  operations: 0,
  features: [],
  mbps,
  gbps: 0,
});

// suite key (u8_*) -> x-axis label. Order = display order (views, queries,
// allocating). codePointCount is omitted: it has no native counterpart.
const PAYLOADS: Record<string, string> = {
  u8_slice: "slice",
  u8_substring: "substring",
  u8_substr: "substr",
  u8_charAt: "charAt",
  u8_at: "at",
  u8_trim: "trim",
  u8_trimStart: "trimStart",
  u8_trimEnd: "trimEnd",
  u8_split: "split",
  u8_length: "length",
  u8_byteAt: "byteAt",
  u8_codePointAt: "codePointAt",
  u8_indexOf: "indexOf",
  u8_lastIndexOf: "lastIndexOf",
  u8_includes: "includes",
  u8_startsWith: "startsWith",
  u8_endsWith: "endsWith",
  u8_equals: "equals",
  u8_compare: "compare",
  u8_toUpperCase: "toUpperCase",
  u8_toLowerCase: "toLowerCase",
  u8_repeat: "repeat",
  u8_padStart: "padStart",
  u8_padEnd: "padEnd",
  u8_concat: "concat",
  u8_replace: "replace",
  u8_replaceAll: "replaceAll",
};

const chartData: Record<string, BenchResult[]> = {};
for (const suite of Object.keys(PAYLOADS)) {
  chartData[suite] = [
    bar(1, "native (baseline)"), // native vs itself = 1×
    bar(speedup(suite), "str8 (SIMD)"),
  ];
}

const config = createBarChart(chartData, PAYLOADS, {
  title: "str8 - every String op vs its UTF-8 str8 counterpart (ASCII input)",
  yLabel: "Speedup vs native (× - higher is faster)",
  xLabel: "",
  datasetLabels: ["native (baseline)", "str8 (SIMD)"],
  colors: [MODE_BARS[0], MODE_BARS[3]],
  yStep: 2,
  labelRotation: -90,
  labelFontSize: 10,
});

const opts = config.options!;
const xTicks = opts.scales!.x!.ticks!;
xTicks.autoSkip = false;
xTicks.maxRotation = 90;
xTicks.minRotation = 90;
opts.plugins!.datalabels!.formatter = (v: number) =>
  (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + "×";
opts.layout = { padding: { top: 8, right: 16, bottom: 96, left: 8 } };
const maxV = Math.max(...Object.values(chartData).map((d) => d[1].mbps));
opts.scales!.y!.max = Math.ceil(maxV * 1.18);

fs.mkdirSync("./build/charts", { recursive: true });
const dims = { width: 1700, height: 820 };
generateChart(config, "./build/charts/per-op-speedup-str8.svg", dims);
generateChart(config, "./build/charts/per-op-speedup-str8.png", dims);
