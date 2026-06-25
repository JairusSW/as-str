// str8 throughput chart from the SIMD and no-SIMD as-bench logs.
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
interface AsBenchLog {
  benches: AsBenchEntry[];
}

const readLog = (p: string): AsBenchLog =>
  JSON.parse(fs.readFileSync(p, "utf-8")) as AsBenchLog;

const SIMD = readLog("./build/logs/bench.simd.json");
const SWAR = readLog("./build/logs/bench.nosimd.json");

function mops(log: AsBenchLog, suite: string, isLib: boolean): number {
  const hit = log.benches.find(
    (b) => b.suite === suite && b.name.startsWith("str8.") === isLib,
  );
  if (!hit) throw new Error(`no bench in suite "${suite}" (isLib=${isLib})`);
  const ns = hit.result.point * 1e6;
  return 1000 / ns; // Mops/s
}

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

// Same operation set/order as the UTF-16 throughput chart.
const PAYLOADS: Record<string, string> = {
  u8_slice: "slice",
  u8_trim: "trim",
  u8_indexOf: "indexOf",
  u8_includes: "includes",
  u8_lastIndexOf: "lastIndexOf",
  u8_compare: "compare",
  u8_equals: "equals",
  u8_toUpperCase: "toUpperCase",
  u8_toLowerCase: "toLowerCase",
};

const chartData: Record<string, BenchResult[]> = {};
for (const suite of Object.keys(PAYLOADS)) {
  chartData[suite] = [
    bar(mops(SIMD, suite, false), "native String"),
    bar(mops(SWAR, suite, true), "str8 (SWAR)"),
    bar(mops(SIMD, suite, true), "str8 (SIMD)"),
  ];
}

const config = createBarChart(chartData, PAYLOADS, {
  title: "str8 - UTF-8 operation throughput (2 kb ASCII input)",
  yLabel: "Throughput (Mops/s)",
  xLabel: "",
  datasetLabels: ["native String", "str8 (SWAR)", "str8 (SIMD)"],
  colors: [MODE_BARS[0], MODE_BARS[2], MODE_BARS[3]],
  yStep: 5,
});

fs.mkdirSync("./build/charts", { recursive: true });
const dims = { width: 1300, height: 620 };
generateChart(config, "./build/charts/throughput-str8.svg", dims);
generateChart(config, "./build/charts/throughput-str8.png", dims);
