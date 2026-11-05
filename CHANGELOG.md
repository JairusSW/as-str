# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Resolve switch-case locals and namespace globals by their actual declarations,
  including globals outside a local's scope and expressions in case labels.
- Rewrite nested packed-span calls in expression containers, and retain native
  signatures for parameters used by defaults and helpers called from defaults.
- Support nullable view equality, positioned `includes`, and omitted or null
  separators in the manual `split` API.
- Preserve native lowercase allocation identity across function boundaries.
- Rewrite promoted calls inside computed callees and function-returning calls,
  preserving callee-before-argument evaluation order.
- Preserve native substring snapshots across raw-memory callees and accessors,
  virtual overrides, opaque callbacks, host calls, and constructor initialization. Sensitive packed calls
  capture a native snapshot before evaluating later arguments.
- Bound long-needle substring verification with an allocation-free Two-Way
  fallback for both UTF-16 and UTF-8, in both search directions.
- Index local and packed-parameter uses instead of walking the function for each
  candidate; clarify that manual view creation allocates wrapper objects.

## [0.7.0] - 2026-10-30

### Changed

- Improve UTF-16 and UTF-8 substring search, short-range equality, splitting,
  and repeated fills with bounded SWAR and SIMD scans.
- Avoid temporary encodings for native-string `str8` comparisons, ASCII
  searches, and metadata queries.
- Reuse AssemblyScript's optimized whitespace classifier for UTF-16 and UTF-8
  trimming, and reduce transform traversal and type-resolution overhead.
- Strengthen semantic-cache identity checks with compiler options, dependency
  sources, and the transform implementation. Version 1 and stale caches fall
  back to syntax analysis; regenerate metadata with `as-str/global`.

### Fixed

- Preserve nullable strings, explicit views, native bounds checks, evaluation
  order, and backing owners during packed-span and lowercase rewrites.
- Resolve aliases, imported and inherited class members, generic defaults,
  callback signatures, arrays, and rest parameters at their actual call sites.
- Preserve search positions when lowering `includes`, support view needles on
  native-string searches, and keep `localeCompare` type-correct after promotion.
- Avoid generated helper and type-name collisions, including constructor
  parameter properties, nested functions, enums, and imported helpers.
- Preserve native repeat-count and padding-length validation when receivers
  are promoted to views, including argument evaluation before an error.
- Keep native string allocation identity in functions that observe raw pointers,
  including observations through method results and local aliases.
- Correct relative imports at package roots and across Windows drives or shares.
- Honor UTF-8 encoding flags and error modes, reject malformed checked UTF-8
  inputs, and validate allocation sizes before narrowing to wasm32.
- Preserve U+0085 (NEL) during trimming to match native `String.trim` semantics.

### Added

- Differential, allocation, consumer-package, and corpus benchmark coverage,
  including exhaustive UTF-16 whitespace checks and SWAR/SIMD boundary cases.

## [0.6.0] - 2026-07-30

### Added

- Packed-span ownership is now represented as a structural link, allowing
  stable string literals and chained scalarized spans to remain allocation-free
  without relying on a parent variable-name field.
- Automatic lowercase analysis now distinguishes repeated or reused results
  from one-shot native identifiers and freshly sliced tokens.

### Changed

- Class-backed parameter promotion now requires enough internal view boundaries
  to remove a net allocation. Automatic return promotion no longer substitutes
  a `Str` wrapper for an otherwise equivalent native allocation.
- Native `toLowerCase()` calls use the allocation-aware helper only when reuse
  or receiver shape makes its pre-scan profitable. View receivers continue to
  use the span-aware path.

### Fixed

- One-shot lowercase rewrites no longer trade a small Wasm instruction-count
  reduction for worse wall time on short token-heavy workloads.

## [0.5.2] - 2026-07-24

### Fixed

- Function-boundary promotion now converts expressions whose string
  representation cannot be recovered from syntax alone, including fields with
  ambiguous names across classes. Generated callers therefore remain
  type-correct when their callee is specialized from `string` to `str`.

## [0.5.1] - 2026-07-24

### Added

- A Unicode-correct `toLowerCase()` fast path that returns an
  already-lowercase ASCII native string unchanged, avoiding the duplicate
  allocation.
- Automatic lowering of native and view-backed `toLowerCase()` calls through
  the allocation-aware fast path.

### Changed

- Automatic mode now requires three profitable uses before introducing a
  class-backed view for a parameter, return, or local. Allocation-free packed
  spans, scalarized lengths, explicit preferences, and existing view boundaries
  remain exempt.

### Fixed

- Low-use string values no longer replace a native substring allocation with an
  equally costly wrapper allocation, eliminating downstream rule regressions
  while retaining profitable zero-copy rewrites.

## [0.5.0] - 2026-07-23

### Added

- `--transform as-str/global` as the explicit entry point for global `str` and
  `Str` import injection.
- `--transform as-str/auto` as the direct, environment-free entry point for
  automatic in-process dual-pass native-string view optimization.
- `--transform as-str/single` as a faster syntax-only automatic mode that
  optimizes safe locals without promoting function parameters or returns.
- Allocation-free packed-span specialization across exported dependency
  helpers when every whole-program reference is a direct, rewritable call.
- Packed-span ASCII-insensitive literal comparison, allowing proven
  `toLowerCase()`-then-compare paths to avoid both allocations.

### Removed

- Bare `--transform as-str` and the legacy `--transform as-str/transform`
  entrypoints. Use `as-str/global` or `as-str/auto` explicitly.
- The `AS_STR_OPTIMIZE` mode switch. Transform behavior is selected solely by
  its entrypoint.
- The `as-strc` wrapper. Use `asc --transform as-str/auto` directly.

### Changed

- Transform internals now centralize operation semantics, packed-span planning
  and lowering, and source admission so every optimization pass uses the same
  safety and capability decisions.
- Global, automatic, and single-pass transform fixtures now compile through one
  shared harness with consistent environment, artifact, and diagnostic handling.

### Fixed

- Automatic mode now retains resolved semantic facts when a shadow compile has
  unrelated errors, while disabling parameter and return promotion for the
  incomplete analysis.
- Locals remain native when a view-producing method result flows into a native
  assignment, an unknown external call, or an operator that cannot safely mix
  native strings and views.
- Automatic mode no longer injects the view runtime into sources where every
  proposed optimization was rejected.
- Native-result method chains remain native instead of allocating intermediate
  view objects only to materialize them back into a string.
- Non-escaping views consumed by scalar methods such as `indexOf`,
  `charCodeAt`, `startsWith`, and `endsWith` are packed into pointer spans,
  eliminating both the native-string copy and the intermediate view object.
- Methods implementing interfaces retain their native-string ABI instead of
  being treated as closed-world specialization candidates.
- Function-boundary promotion now requires a complete semantic manifest, so
  syntax-only optimization cannot change an inferred ABI.
- Equivalent dependency aliases share specialization decisions without
  producing mismatched call signatures; ambiguous definitions remain native.
- Ordinary class-backed views do not cross exported dependency boundaries,
  preventing speculative view-object regressions in unrelated rules.
- Transform settings are read per compilation, enabling isolated external
  semantic-analysis and optimized passes in long-lived compiler processes.
- Debug source reports now reflect the complete source-admission decision,
  including package self-exclusion and `str` name conflicts.

## [0.4.0] - 2026-07-21

### Added

- Experimental conservative native-`string` to `str` optimization through
  `AS_STR_OPTIMIZE=1`, including local data-flow, safe boundary conversions,
  internal parameter/return specialization, cross-module signature awareness,
  safety diagnostics, and allocation-path fixture coverage.
- `as-strc`, a two-pass compiler wrapper that records resolved string facts in
  a temporary semantic manifest before the optimized build.
- `// @as-str no-view` and `// @as-str prefer-view` local optimization controls.
- Differential optimized/unoptimized corpus tests, allocation-path reporting,
  clean-consumer packaging tests, and cross-platform import-path coverage.
- Aggregate optimization summaries and statically resolved local callback,
  method, typed-container, and explicitly non-null conversion support.

### Changed

- Full-range `Str#toString()` now returns its backing native string directly;
  sliced views still materialize a copy.
- The transform and `as-strc` wrapper now use source-first TypeScript modules;
  published JavaScript is generated by the build.
- Transform and CLI build scripts now format generated publish artifacts so a
  release build is deterministic and does not leave unrelated generated files
  modified.
- The AssemblyScript peer dependency and compatibility matrix now include
  0.28.10, validated against full downstream Impart rule bundles.

### Fixed

- Automatic imports now cover dependency sources loaded by AssemblyScript as
  `~lib`, including pnpm/workspace packages, instead of only entry-project
  sources.
- Import injection now selects the exported `Str` implementation class when a
  source uses it, recognizes callable-only `str(value)` usage, and explicitly
  excludes `as-str`'s own `~lib/as-str/*` sources to prevent recursive imports.

## [0.3.0] - 2026-06-25

### Added

- **Named forms of every operator overload** on `str` and `str8`, so editors
  whose TypeScript language server doesn't understand AssemblyScript's
  `@operator` overloads can call a method instead of using the operator. The
  `@operator` decorator now lives on the descriptively-named method itself, so
  `a + b` and `a.add(b)` are the same call: `equals` (`==`), `notEquals` (`!=`),
  `lessThan`/`lessThanOrEqual`/`greaterThan`/`greaterThanOrEqual`
  (`<`/`<=`/`>`/`>=`), `add` (`+`, returns a view), and `get` (`[]`). Also added
  `set(other)`, which re-points a view in place at another view's contents.
- Delimiter helpers on `str` and `str8`: `before`, `after`, `between`,
  `beforeLast`, `afterLast`, and `betweenLast`.
- `str8` QOL helpers: `isAscii`, `byteLength`, `sliceChars`, and
  `nextCodePoint`.

### Changed

- The transform can now be added as `--transform as-str` (or
  `"transform": ["as-str"]` in `asconfig.json`) - the package `main` points at
  it. The previous `as-str/transform` specifier still works.
- The transform now injects the bare `import { str } from "as-str"` instead of
  `as-str/assembly/index`, matching how you import `str` manually.

## [0.2.1] - 2026-06-24

### Changed

- `homepage` now points to the documentation site
  (<https://docs.jairus.dev/as-str>) instead of the GitHub README.

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
