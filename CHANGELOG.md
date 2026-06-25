# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-24

### Added

- **`str(x)` / `str8(x)` converters** - `str` and `str8` are now callable as
  functions that convert any value to the respective view: a `str`/`str8` is
  returned as-is, a native `string` is wrapped/transcoded, and anything else
  with a `toString()` (numbers, the other view type, user classes, …) is
  stringified then wrapped - dispatched at compile time via `isDefined`.
- **`.toStr()` / `.toStr8()` methods** on both views - convert between the
  UTF-16 `str` and UTF-8 `str8` representations (the same-type call is identity).
- **`str8`** - a zero-copy **UTF-8** string view, the byte-indexed sibling of
  `str` (Rust `&str` / Go `string` model). It is stored as an `ArrayBuffer` of
  UTF-8 bytes plus a `[start, end)` pair of raw byte pointers; inputs may be a
  native `string` (`str8.from`, transcoded to UTF-8 - allocates) or an existing
  UTF-8 `ArrayBuffer` (`str8.fromBuffer`/`fromBufferChecked`, wrapped zero-copy).
  Indices are **byte offsets**: `length`/`byteLength` are the byte length,
  `slice`/`substring`/`substr` are O(1) zero-copy byte slices, and
  `indexOf`/`lastIndexOf` return byte offsets. Codepoint access is layered on
  top via `codePointAt`, `codePointCount`, `byteAt`, `isCharBoundary`, and the
  `[]` operator returns a raw byte (Go `s[i]`). `equals`/`compareTo`/`<`…`>=`
  use byte order, which for UTF-8 equals Unicode codepoint order (matching
  Rust/Go). Allocating ops (`concat`, `repeat`, `padStart`, `padEnd`, `replace`,
  `replaceAll`, `toUpperCase`, `toLowerCase`) build a fresh UTF-8 buffer and
  return a `str8`; `toString` decodes to a native `string`; `split` yields
  zero-copy `str8` pieces. Mirrors `str`'s instance + static free-function
  surface (accepting `string | str8 | ArrayBuffer`) and adds `str8.UTF8`/
  `str8.UTF16` interop plus `toStr`/`str8.fromStr` bridges to `str`.
  Import-only (`import { str8 } from "as-str"`); not yet auto-injected by the
  transform.

  Caveats: `length` is bytes (not characters - use `codePointCount()`); slicing
  cuts raw bytes Go-style and may split a codepoint (`isCharBoundary` guards);
  `fromBuffer` trusts its input (use `fromBufferChecked` for untrusted bytes).

### Changed

- The implementation classes are now exported as **`Str`** / **`Str8`**, with
  **`str`** / **`str8`** as the public type aliases + callable converters
  (mirroring how the standard library pairs `String` with `string`). Existing
  usage (`: str`, `str.from(…)`, `str.slice(…)`, `str.UTF8`, …) is unchanged.

### Performance

- **`str.toUpperCase` / `str.toLowerCase`** take an ASCII fast path (SIMD/SWAR
  byte fold in one allocate-and-scan pass) instead of materializing then calling
  the native Unicode-aware method - ~3.8× faster than native on ASCII input
  (was ~1.1× slower); non-ASCII still defers to native for correctness.
- `str8` ships vectorized (SIMD `i8x16` / SWAR `u64` / scalar) `codePointCount`
  and the same ASCII case-fold fast path; constant SIMD masks are `@lazy` so
  they tree-shake under `--disable simd`.

## [0.1.2] - 2026-06024

### Changed

- chore: switch transform to typescript

## [0.1.1] - 2026-06-23

### Changed

- chore: update charts. rename to as-str

## [0.1.0] - 2026-06-23

Initial release - `as-str`, virtual (zero-copy) strings for AssemblyScript.

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
- Optional **global mode**: `--transform as-str/transform` injects
  `import { str }` into any source that uses `str` without importing it (so no
  per-file import is needed), with editor typings via the `as-str/globals.json`
  `extends` preset (or a dropped-in `globals/index.d.ts`). Detection is
  deliberately conservative because `str` is a common identifier.
- Spec suite (run under `simd` and `nosimd` modes), differential fuzzing against
  native `String`, microbenchmarks, and a benchmark-publishing workflow
  (`npm run charts:publish`) that pushes charts to the `docs` branch.
