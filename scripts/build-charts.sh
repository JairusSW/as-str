#!/usr/bin/env bash
# Run the benchmarks under both the SIMD and SWAR builds, capture as-bench's
# machine-readable JSON, then render the charts.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p ./build/logs ./build/charts

echo "Benchmarking SIMD build..."
npx asb run --json >./build/logs/bench.simd.json

echo "Benchmarking SWAR build (--disable simd)..."
npx asb run --mode nosimd --json >./build/logs/bench.nosimd.json

echo "Rendering charts..."
bun ./scripts/build-throughput.ts
bun ./scripts/build-per-op.ts
