// chart01 - ported from json-as's scripts/build-chart01.ts and fed with str
// data. Same grouped-bar throughput chart, same bench lib (createBarChart /
// generateChart / BenchResult from ./lib/bench-utils, MODE_BARS from
// ./lib/palette). Here each "payload" is a string operation and the series are
// the three code paths (native String / str SWAR / str SIMD).
//
// Reads the two as-bench `--json` logs produced by scripts/build-charts.sh:
//   build/logs/bench.simd.json    - default build (SIMD path)
//   build/logs/bench.nosimd.json  - --disable simd build (SWAR path)
import fs from "node:fs";
import {
  createBarChart,
  generateChart,
  type BenchResult,
} from "./lib/bench-utils";
import { MODE_BARS } from "./lib/palette";

// as-bench JSON shapes (subset we need).
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

// Throughput in millions of ops/sec (higher is better) from the per-op time.
function mops(log: AsBenchLog, suite: string, isLib: boolean): number {
  const hit = log.benches.find(
    (b) => b.suite === suite && b.name.includes("str") === isLib,
  );
  if (!hit) throw new Error(`no bench in suite "${suite}" (isLib=${isLib})`);
  const ns = hit.result.point * 1e6;
  return 1000 / ns; // 1 / ns-per-op * 1e3 = Mops/s
}

// Wrap a throughput number as a BenchResult so it flows through createBarChart,
// which charts the `mbps` field.
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

// x-axis groups: a representative spread of operations (all over the same 2 kb
// string). The scan ops are where SWAR and SIMD pull away from native.
const PAYLOADS: Record<string, string> = {
  slice: "slice",
  trim: "trim",
  indexOf: "indexOf",
  includes: "includes",
  lastIndexOf: "lastIndexOf",
  compare: "compare",
};

const chartData: Record<string, BenchResult[]> = {};
for (const suite of Object.keys(PAYLOADS)) {
  chartData[suite] = [
    bar(mops(SIMD, suite, false), "native String"), // native - same in both builds
    bar(mops(SWAR, suite, true), "str (SWAR)"),
    bar(mops(SIMD, suite, true), "str (SIMD)"),
  ];
}

const config = createBarChart(chartData, PAYLOADS, {
  title: "str - String operation throughput (2 kb input)",
  yLabel: "Throughput (Mops/s)",
  xLabel: "",
  datasetLabels: ["native String", "str (SWAR)", "str (SIMD)"],
  // native = strawberry red baseline, SWAR = jungle green, SIMD = pacific blue.
  colors: [MODE_BARS[0], MODE_BARS[2], MODE_BARS[3]],
  yStep: 5,
});

fs.mkdirSync("./build/charts", { recursive: true });
generateChart(config, "./build/charts/chart01.svg");
generateChart(config, "./build/charts/chart01.png");
