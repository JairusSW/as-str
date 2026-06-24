# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-06-23

### Changed

- chore: update charts

## [0.1.0] - 2026-06-23

Initial release - `str-as`, virtual (zero-copy) strings for AssemblyScript.

### Added

- **`str`** - a zero-copy string view: a backing `string` (the GC owner) plus a
  `[start, end)` pair of raw byte pointers. View-producing ops (`slice`,
  `substring`, `substr`, `charAt`, `at`, `trim`/`trimStart`/`trimEnd`/`trimLeft`/
  `trimRight`, `split`, and the `[]`/`+` operators) move pointers and copy
  nothing; allocating ops (`concat`, `repeat`, `padStart`, `padEnd`, `replace`,
  `replaceAll`, `toUpperCase`, `toLowerCase`, `toString`) return a fresh real
  `string`; queries (`length`, `isEmpty`, `charCodeAt`, `codePointAt`, `indexOf`,
  `lastIndexOf`, `includes`, `startsWith`, `endsWith`, `equals`, `compareTo`,
  comparison operators) allocate nothing. Offsets are UTF-16 code units.
- One lowercase **`str` class** is the whole API: the type, the instance methods,
  **and** the static free-function surface (`str.slice(s, …)`), where the first
  argument may be a `string` or a `str`. Constructors `from`, `fromRange`,
  `fromCharCode`, `fromCharCodes`, `fromCodePoint`, and `MAX_LENGTH` mirror
  `String`.
- **Operators**: `==`, `!=`, `<`, `<=`, `>`, `>=` (content comparisons), `+`
  (concatenate into a fresh view), and `[]` (allocation-free code-unit access,
  `-1` out of range). `indexOf`/`lastIndexOf`/`includes`/`startsWith`/`endsWith`/
  `concat` accept a `string` **or** a `str`. Semantics mirror AssemblyScript's
  `String` (not JS).
- **SWAR + optional SIMD** (`--enable simd`) for the scanning hot paths
  (`findUnit` → indexOf/includes/lastIndexOf; `compare` → ordering), size-tiered
  `copyBytes`/`equalsBytes`, and direct (no-materialize) `replace`/`replaceAll`/
  `concat`/`repeat`/`padStart`/`padEnd`. `@inline` is reserved for small leaf
  helpers so consumers can still get small wasm modules. `replace`/`replaceAll`
  are correct where this asc version's native `String#replaceAll` corrupts longer
  replacements, and are fuzzed against a trusted reference.
- **UTF-8 / UTF-16** via `str.UTF8` / `str.UTF16` (mirrors `String.UTF8` /
  `String.UTF16`), powered by [`utf-as`](https://github.com/JairusSW/utf-as),
  operating straight off the view's range.
- Optional **global mode**: `--transform str-as/transform` injects
  `import { str }` into any source that uses `str` without importing it (so no
  per-file import is needed), with editor typings via the `str-as/globals.json`
  `extends` preset (or a dropped-in `globals/index.d.ts`). Detection is
  deliberately conservative because `str` is a common identifier.
- Spec suite (run under `simd` and `nosimd` modes), differential fuzzing against
  native `String`, microbenchmarks, and a benchmark-publishing workflow
  (`npm run charts:publish`) that pushes charts to the `docs` branch.
