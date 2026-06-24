# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Stopped force-inlining the public API. `@inline` is now reserved for small
  leaf helpers only (`unitLength`, `allocString`, `isWhiteSpace`, and the
  `bData`/`bStart`/`bEnd` bound extractors); the public methods and the large
  SWAR/SIMD kernels (`findUnit`, `compare`, `copyBytes`, `equalsBytes`) are left
  to the optimizer to decide, so consumers can still get small wasm modules.
- Unified the whole API onto a single lowercase **`vstring` class**: it is the
  type, the instance methods, **and** the static free-function surface
  (`vstring.slice(s, …)`) - no separate `VString` class and no `type vstring`
  alias. `VString` is now just a PascalCase **alias export** for the same class
  (`export { vstring, vstring as VString }`), so both names work and refer to one
  implementation.
- README charts are now hosted on the `docs` branch (per published version)
  instead of being tracked in `main`; the `<img>` URLs point at
  `refs/heads/docs/charts/v<version>/`.

### Added

- Optional **global mode**: `--transform vstring/transform` injects
  `import { vstring }` into any user source that references it without
  importing (so no per-file import is needed), and `globals/index.d.ts` +
  `globals.json` provide the matching ambient typings for editors (opt
  in by extending the preset:
  `"extends": ["assemblyscript/std/assembly.json", "vstring/globals.json"]`).
  The transform only injects names a file uses and doesn't already import, skips
  the library's own sources, and force-parses the `vstring` module so the import
  resolves even when nothing else imports it. Path logic ported from json-as's
  transform.
- Benchmark publishing workflow (`npm run charts:publish` →
  `scripts/publish-benchmarks.sh`, ported from json-as): benchmarks both builds,
  renders the charts, and commits them to the `docs` branch under
  `charts/v<version>/` via a throwaway git worktree (the main working tree is
  never touched), then re-pins the README chart `<img>` URLs to that version.
  Supports `--no-run` to reuse existing logs.

## [0.1.0] - 2026-06-23

### Changed

- **Renamed the core class `VString` → `vstring`** (lowercase, like `string`).
  `vstring` is now the class/type with the free functions merged on as a
  namespace. Because a class can't also be a callable, the `vstring(s)` converter
  is replaced by **`vstring.from(s)`**. `VString` remains as a deprecated type
  alias for migration.

### Added

- Initial scaffold of the `VString` virtual-string core.
- `VString` class: a zero-copy view (`data` + `start`/`end` byte pointers) with
  view-producing methods (`slice`, `substring`, `substr`, `trim`, `trimStart`,
  `trimEnd`, `charAt`, `at`), query methods (`length`, `isEmpty`, `charCodeAt`,
  `codePointAt`, `indexOf`, `lastIndexOf`, `includes`, `startsWith`, `endsWith`,
  `equals`, `equalsString`, `compareTo`), comparison operators, and
  `toString` materialization.
- `vstring()` converter and the `vstring.*` namespace of free functions that
  accept a real `string` or a `VString`.
- SWAR + optional SIMD (`ASC_FEATURE_SIMD`) acceleration for the scanning hot
  paths: `findUnit` powers `indexOf`/`includes`/`lastIndexOf`, and `compare`
  drives the ordering operators. ~2.9–7.6× faster `indexOf` on long inputs.
- Spec suite (run under `simd` and `nosimd` modes), differential fuzzing against
  native `String` across both modes, and microbenchmarks.
- Benchmark charts (`npm run charts:build`), using json-as's chart library
  (`bench-utils.ts` + `palette.ts`): `chart01` renders a native / SWAR / SIMD
  throughput grouped-bar, and `chart-all` compares every String operation with
  its vstring counterpart (native vs vstring-SIMD grouped bars, per-op speedup).
  Backed by a comprehensive bench covering the full operation surface, all over
  one ~2 kb input string.

### Changed

- The `vstring.*` namespace no longer allocates a throwaway wrapper view for a
  `string` argument. Instance methods and free functions now funnel through
  `VString.*Range` static helpers over raw `(data, start, end)` bounds: a
  view-producing op is one allocation (the result), a query is zero. Removing
  the extra allocation roughly halved single-char `indexOf` (now ~13× native),
  turned `compare` from ~2.4× slower into ~1.1× faster, and brought `slice`/
  `trim` back to parity with native on tiny inputs.
- `concat`, `repeat`, `padStart`, and `padEnd` now build their result in a
  single allocation directly from the view, instead of materializing a copy and
  then calling the native op. This removes the extra copy and brings all four
  from ~0.64–0.84× back to parity (~1.0×) with native. `startsWith`/`endsWith`
  compare in place via `memory.compare` (and clamp positions like native).
- Copies go through a size-tiered `copyBytes`: small copies use a manual
  unrolled loop (v128 blocks under SIMD, else u64, plus a scalar tail), large
  copies defer to the `memory.copy` intrinsic. This makes `padStart`/`padEnd`
  ~1.9× *faster* than native (their pad fill no longer pays per-call
  bulk-memory overhead for each repeated unit) while keeping the large-copy ops
  at parity.
- Equality checks (`equals`, `startsWith`, `endsWith`, and the
  `indexOf`/`lastIndexOf` verify step) go through a size-tiered `equalsBytes`: a
  manual v128/u64 scan that early-exits on the first mismatch and computes no
  ordering, falling back to `memory.compare` for large ranges. (Roughly neutral
  on large inputs, where `memory.compare` is already well-optimized; the win is
  on small/medium comparisons.)
- `replace` and `replaceAll` are now built directly from the view (find via the
  SWAR/SIMD scan, assemble in one allocation) instead of materializing then
  deferring to native. This makes `replace` ~12× and `replaceAll` ~3.7× faster
  than native here, and - notably - sidesteps a bug in this asc version's
  `String#replaceAll`, which corrupts the result (emits NUL bytes) for longer
  replacement strings. vstring' `replaceAll` is differentially fuzzed against a
  trusted indexOf/slice/concat reference instead.

### Added

- `vstring` is now also a **type** (`type vstring = VString`), so views can be
  annotated with either `vstring` or `VString`. Achieved by merging the free
  functions as a namespace onto `VString`, which keeps the `vstring()` converter
  and `vstring.*` calls working alongside the new type alias.
- More operator overloads on `VString`: `<=`, `>=` (joining `==`/`!=`/`<`/`>`,
  all content comparisons), and `[]` for allocation-free code-unit access
  (`v[i]` → the UTF-16 unit at `i`, or -1 out of range).
- `indexOf`, `lastIndexOf`, `includes`, `startsWith`, `endsWith` (instance and
  namespace) and `concat` now accept a `VString` *or* a `string` for their
  search/operand argument - you can search a view inside a view.
- `VString` now exposes the **full native `String` method surface** as instance
  methods: `concat`, `repeat`, `padStart`, `padEnd`, `replace`, `replaceAll`,
  `toUpperCase`, `toLowerCase`, `split` (with `limit`), `trimLeft`/`trimRight`
  aliases, and `localeCompare`, plus the `+` (concat) operator and the static
  constructors `fromCharCode`, `fromCharCodes`, `fromCodePoint`. The
  materializing ones forward to the optimized `vstring.*` statics.
- `VString` also matches `String`'s **static** surface: the `MAX_LENGTH`
  constant and the `UTF8` / `UTF16` encoding namespaces (`byteLength`, `encode`,
  `encodeUnsafe`, `decode`, `decodeUnsafe`, plus utf-as's `validate` /
  `utf16Length`). These are powered by [`utf-as`](https://github.com/JairusSW/utf-as)
  (SWAR/SIMD, pointer-based), so both UTF-16 *and* UTF-8 run straight off the
  view's range with no intermediate copy (UTF-8 sizing uses utf-as's new
  `byteLengthUnsafe`); `decode` returns a `VString`. Adds a runtime dependency
  on `utf-as`.

### Fixed

- `lastIndexOf` now clamps a negative `from` to `0`, matching native
  `String#lastIndexOf` (caught by differential fuzzing).
