// Per-op speedup chart from build/logs/bench.simd.json.
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
    (b) => b.suite === suite && b.name.startsWith("str.") === isLib,
  );
  if (!hit) throw new Error(`no bench in suite "${suite}" (isLib=${isLib})`);
  return hit.result.point * 1e6;
}
const speedup = (suite: string): number => ns(suite, false) / ns(suite, true);

// createBarChart charts the `mbps` field.
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

// suite name -> x-axis label.
const PAYLOADS: Record<string, string> = {
  slice: "slice",
  substring: "substring",
  substr: "substr",
  charAt: "charAt",
  at: "at",
  trim: "trim",
  trimStart: "trimStart",
  trimEnd: "trimEnd",
  split: "split",
  length: "length",
  charCodeAt: "charCodeAt",
  codePointAt: "codePointAt",
  indexOf: "indexOf",
  lastIndexOf: "lastIndexOf",
  includes: "includes",
  startsWith: "startsWith",
  endsWith: "endsWith",
  equals: "equals",
  compare: "compare",
  toUpperCase: "toUpperCase",
  toLowerCase: "toLowerCase",
  repeat: "repeat",
  padStart: "padStart",
  padEnd: "padEnd",
  concat: "concat",
  replace: "replace",
  replaceAll: "replaceAll",
};

const chartData: Record<string, BenchResult[]> = {};
for (const suite of Object.keys(PAYLOADS)) {
  chartData[suite] = [
    bar(1, "native (baseline)"), // native vs itself = 1×
    bar(speedup(suite), "str (SIMD)"),
  ];
}

const config = createBarChart(chartData, PAYLOADS, {
  title: "str - every String op vs its str counterpart",
  yLabel: "Speedup vs native (× - higher is faster)",
  xLabel: "",
  datasetLabels: ["native (baseline)", "str (SIMD)"],
  // Native baseline, then str SIMD.
  colors: [MODE_BARS[0], MODE_BARS[3]],
  yStep: 2,
  labelRotation: -90,
  labelFontSize: 10,
});

// Keep every x label and format ratios.
const opts = config.options!;
const xTicks = opts.scales!.x!.ticks!;
xTicks.autoSkip = false;
xTicks.maxRotation = 90;
xTicks.minRotation = 90;
opts.plugins!.datalabels!.formatter = (v: number) =>
  (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + "×";
// Room for rotated x labels.
opts.layout = { padding: { top: 8, right: 16, bottom: 96, left: 8 } };
// Keep the tallest label inside the chart.
const maxV = Math.max(...Object.values(chartData).map((d) => d[1].mbps));
opts.scales!.y!.max = Math.ceil(maxV * 1.18);

fs.mkdirSync("./build/charts", { recursive: true });
const dims = { width: 1700, height: 820 };
generateChart(config, "./build/charts/per-op-speedup.svg", dims);
generateChart(config, "./build/charts/per-op-speedup.png", dims);
