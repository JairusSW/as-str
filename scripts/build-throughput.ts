// Throughput chart from the SIMD and no-SIMD as-bench logs.
import fs from "node:fs";
import {
  createBarChart,
  generateChart,
  type BenchResult,
} from "./lib/bench-utils";
import { MODE_BARS } from "./lib/palette";

// as-bench JSON subset.
interface AsBenchEntry {
  suite: string;
  name: string;
  result: { point: number }; // per-op time, milliseconds
}
interface AsBenchLog {
  benches: AsBenchEntry[];
}

const readLog = (p: string): AsBenchLog =>
  JSON.parse(fs.readFileSync(p, "utf-8")) as AsBenchLog;

const SIMD = readLog("./build/logs/bench.simd.json");
const SWAR = readLog("./build/logs/bench.nosimd.json");

// Convert per-op time to millions of ops/sec.
function mops(log: AsBenchLog, suite: string, isLib: boolean): number {
  const hit = log.benches.find(
    (b) => b.suite === suite && b.name.startsWith("str.") === isLib,
  );
  if (!hit) throw new Error(`no bench in suite "${suite}" (isLib=${isLib})`);
  const ns = hit.result.point * 1e6;
  return 1000 / ns; // Mops/s
}

// createBarChart charts the `mbps` field.
const bar = (mbps: number, description: string): BenchResult => ({
  language: "as",
  description,
  elapsed: 0,
  bytes: 0,
  operations: 0,
  features: [],
  mbps,
  gbps: mbps / 1000,
});

// Same operation set/order as the str8 throughput chart.
const PAYLOADS: Record<string, string> = {
  slice: "slice",
  trim: "trim",
  indexOf: "indexOf",
  includes: "includes",
  lastIndexOf: "lastIndexOf",
  compare: "compare",
  equals: "equals",
  toUpperCase: "toUpperCase",
  toLowerCase: "toLowerCase",
};

const chartData: Record<string, BenchResult[]> = {};
for (const suite of Object.keys(PAYLOADS)) {
  chartData[suite] = [
    bar(mops(SIMD, suite, false), "native String"),
    bar(mops(SWAR, suite, true), "str (SWAR)"),
    bar(mops(SIMD, suite, true), "str (SIMD)"),
  ];
}

const config = createBarChart(chartData, PAYLOADS, {
  title: "str - String operation throughput (2 kb input)",
  yLabel: "Throughput (Mops/s)",
  xLabel: "",
  datasetLabels: ["native String", "str (SWAR)", "str (SIMD)"],
  // Native baseline, SWAR, then SIMD.
  colors: [MODE_BARS[0], MODE_BARS[2], MODE_BARS[3]],
  yStep: 5,
});

fs.mkdirSync("./build/charts", { recursive: true });
const dims = { width: 1300, height: 620 };
generateChart(config, "./build/charts/throughput.svg", dims);
generateChart(config, "./build/charts/throughput.png", dims);
