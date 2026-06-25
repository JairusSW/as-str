#!/usr/bin/env bash
# Run the benchmarks under both the SIMD and SWAR builds, capture as-bench's
# machine-readable JSON, then render the charts.
#
#   ./scripts/build-charts.sh            # bench both builds, then render
#   ./scripts/build-charts.sh --no-run   # reuse existing logs, render only
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_BENCHES=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-run)
      RUN_BENCHES=0
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./scripts/build-charts.sh [--no-run]"
      exit 1
      ;;
  esac
done

mkdir -p ./build/logs ./build/charts

if [[ "$RUN_BENCHES" == "1" ]]; then
  echo "Benchmarking SIMD build..."
  npx asb run --json >./build/logs/bench.simd.json

  echo "Benchmarking SWAR build (--disable simd)..."
  npx asb run --mode nosimd --json >./build/logs/bench.nosimd.json
else
  echo "Reusing existing logs..."
  for log in bench.simd.json bench.nosimd.json; do
    if [[ ! -s "./build/logs/$log" ]]; then
      echo "Error: ./build/logs/$log is missing or empty - rerun without --no-run to regenerate it." >&2
      exit 1
    fi
  done
fi

echo "Rendering charts..."
bun ./scripts/build-throughput.ts
bun ./scripts/build-per-op.ts
bun ./scripts/build-throughput-str8.ts
bun ./scripts/build-per-op-str8.ts
