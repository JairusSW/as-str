// build-chart-all - every native String operation vs its str counterpart,
// built from the chart01 template: the json-as `createBarChart` / `generateChart`
// lib, grouped bars with native and str (SIMD) side by side per operation.
//
// Metric is speedup vs native (native = the 1× baseline bar, str = how many
// times faster it runs). Throughput Mops/s spans ~200× across these ops - from
// O(1) charCodeAt to a 1.2 kb scan - which a linear bar chart can't show; the
// speedup ratio keeps every operation on a comparable, readable scale.
//
// Reads build/logs/bench.simd.json (produced by scripts/build-charts.sh).
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
    (b) => b.suite === suite && b.name.includes("str") === isLib,
  );
  if (!hit) throw new Error(`no bench in suite "${suite}" (isLib=${isLib})`);
  return hit.result.point * 1e6;
}
const speedup = (suite: string): number => ns(suite, false) / ns(suite, true);

// Wrap a number as a BenchResult so it flows through createBarChart (it charts
// the `mbps` field).
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

// suite name -> x-axis label. Order = display order (views, queries, allocating).
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
  // native = strawberry red baseline, str = pacific blue (SIMD).
  colors: [MODE_BARS[0], MODE_BARS[3]],
  yStep: 2,
  labelRotation: -90,
  labelFontSize: 10,
});

// Tweaks createBarChart can't express for a 29-bar chart: show every x label
// (rotated, no auto-skip), and print the ratio with a "×" and one decimal.
const opts = config.options!;
const xTicks = opts.scales!.x!.ticks!;
xTicks.autoSkip = false;
xTicks.maxRotation = 90;
xTicks.minRotation = 90;
opts.plugins!.datalabels!.formatter = (v: number) =>
  (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + "×";
// Bottom margin below the auto-fitted x-axis labels, so they aren't jammed
// against the canvas edge.
opts.layout = { padding: { top: 8, right: 16, bottom: 96, left: 8 } };
// Tighten the top of the scale to the tallest bar (+ a little room for its
// label) so the bars climb most of the plot height instead of sitting low.
const maxV = Math.max(...Object.values(chartData).map((d) => d[1].mbps));
opts.scales!.y!.max = Math.ceil(maxV * 1.18);

fs.mkdirSync("./build/charts", { recursive: true });
const dims = { width: 1700, height: 820 };
generateChart(config, "./build/charts/chart-all.svg", dims);
generateChart(config, "./build/charts/chart-all.png", dims);
