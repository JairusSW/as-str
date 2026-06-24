<h1 align="center"><pre>╔═╗╔╦╗╦═╗  ╔═╗╔═╗
╚═╗ ║ ╠╦╝══╠═╣╚═╗
╚═╝ ╩ ╩╚═  ╩ ╩╚═╝</pre></h1>

<p align="center">Virtual, zero-copy strings for AssemblyScript - slice, search, and trim without allocating.</p>

<details>
<summary>Table of Contents</summary>

- [Installation](#installation)
- [Global Mode (optional)](#global-mode-optional)
- [Docs](#docs)
- [Usage](#usage)
- [Examples](#examples)
  - [Slicing and Trimming Without Copying](#slicing-and-trimming-without-copying)
  - [Tokenizing and Splitting](#tokenizing-and-splitting)
  - [Searching (String or View Needles)](#searching-string-or-view-needles)
  - [Comparisons and Operators](#comparisons-and-operators)
  - [Encoding (UTF-8 / UTF-16)](#encoding-utf-8--utf-16)
  - [The Two Layers](#the-two-layers)
- [Performance](#performance)
  - [Per-Operation Speedup](#per-operation-speedup)
  - [Throughput](#throughput)
  - [SWAR and SIMD](#swar-and-simd)
  - [Running Benchmarks Locally](#running-benchmarks-locally)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

</details>

## Installation

```bash
npm install str-as
```

Optionally, for additional performance, also add:

```bash
--enable simd
```

## Global Mode (optional)

By default you `import { str } from "str-as"` where you use it. If you'd
rather use `str` **without an import in every file**, opt into the transform
- it injects the import for you at compile time.

1. Add the transform to your `asc` command:

   ```bash
   --transform str-as/transform
   ```

   or in `asconfig.json`:

   ```json
   { "options": { "transform": ["str-as/transform"] } }
   ```

2. Add the ambient typings so your editor resolves the globals - extend
   str's preset in `assembly/tsconfig.json`:

   ```json
   {
     "extends": ["assemblyscript/std/assembly.json", "str-as/globals.json"],
     "include": ["./**/*.ts"]
   }
   ```

   (For pnpm or other non-hoisted `node_modules` layouts, drop a copy of
   `node_modules/str-as/globals/index.d.ts` into your assembly directory
   instead - any `.d.ts` in the project is picked up automatically.)

Now this compiles with no import:

```typescript
export function method(line: string): string {
  return str.slice(line, 0, line.indexOf(" ")).toString();
}
```

The transform only injects names a file actually uses and doesn't already
import, and never touches the library's own sources - so explicit
`import { str } from "str-as"` keeps working, and you can mix the two
freely.

## Docs

Full documentation lives at:

<https://docs.jairus.dev/str-as>

## Usage

A `str` is a **view** into an existing `string`: a reference to the backing
string (so the GC keeps it alive) plus a `[start, end)` pair of raw byte
pointers. Slicing, trimming, and searching just move the two pointers - **no
characters are copied** until you materialize a real `string` with
`.toString()`.

```typescript
import { str } from "str-as";

const real: string = "GET /index.html 200 1043";

// Wrap once (zero-copy); every op below is a pointer move, not an allocation.
const req: str = str.from(real);

const method = req.slice(0, req.indexOf(" ")); // "GET" - a view
const path = str.slice(real, 4, 15); // "/index.html" - a view

method.toString(); // "GET"  - materialized on demand
path.length; // 11
req.includes("200"); // true
```

`str` is a class, so it is also the type - annotate with `str`. It is the
whole API: the instance methods **and** the static free functions
(`str.slice(s, …)`) live on it. It carries the **full native `String`
surface** (`slice`, `indexOf`, `trim`, `split`, `replace`, `toUpperCase`, …) plus
operators, so it reads like `string` but allocates only at the boundary where you
ask for an owned string back.

## Examples

### Slicing and Trimming Without Copying

View-producing methods return another `str` - no allocation, no copy. The
backing string is shared, and chains of views always anchor to the original.

```typescript
const v = str.from("  the quick brown fox  ").trim(); // view, no copy
v.slice(4, 9).toString(); // "quick"
v.slice(-3).toString(); // "fox"
v.substring(10, 4).toString(); // "quick" (substring swaps args, like String)
v.charAt(0).toString(); // "t"
v.at(-1).toString(); // "x"
```

### Tokenizing and Splitting

`split` yields zero-copy pieces - you only pay for a copy on the pieces you
actually materialize.

```typescript
const log = "GET /index.html 200 1043";
const f = str.split(log, " "); // str[] - each piece is a view
f[0].toString(); // "GET"
<i32>parseInt(f[2].toString()); // 200
f.length; // 4

// Walk fields without allocating until needed:
const csv = "id,name,email,role";
for (let i = 0, parts = str.split(csv, ","); i < parts.length; i++) {
  if (parts[i].equalsString("email")) {
    /* found it - still zero-copy */
  }
}
```

### Searching (String or View Needles)

`indexOf`, `lastIndexOf`, `includes`, `startsWith`, and `endsWith` accept a
`string` **or** a `str` as the needle, so you can search a view inside a
view. The scan is SWAR/SIMD accelerated.

```typescript
const hay = str.from("the quick brown fox");
hay.indexOf("brown"); // 10
hay.includes(str.slice("xxbrownyy", 2, 7)); // true - view needle
hay.startsWith("the"); // true
hay.lastIndexOf("o"); // 17
```

### Comparisons and Operators

Operators compare and index content (not identity), across different backing
strings.

```typescript
const a = str.slice("__world", 2); // "world"
const b = str.slice("hello world", 6); // "world", different backing string

a == b; // true  (content equality)
a <= b; // true  (lexicographic)
str.from("apple") < str.from("banana"); // true
a[0]; // 119  - UTF-16 code unit at 0, no allocation (-1 if out of range)
(a + b).toString(); // "worldworld"  - `+` concatenates into a fresh view
```

### Encoding (UTF-8 / UTF-16)

`str.UTF8` and `str.UTF16` mirror `String.UTF8` / `String.UTF16`,
powered by [`utf-as`](https://github.com/JairusSW/utf-as) and running straight
off the view's pointer range - no intermediate copy. `decode` returns a
`str`.

```typescript
const v = str.slice("xx héllo 世界 xx", 3, 11); // "héllo 世界"

const u8 = str.UTF8.encode(v); // ArrayBuffer of UTF-8 bytes
str.UTF8.byteLength(v); // UTF-8 length, counted in place
str.UTF8.decode(u8); // str round-trip

const u16 = str.UTF16.encode(v); // the view's bytes, copied out
str.UTF16.validate(v); // well-formed UTF-16?
```

### The Two Layers

The same operations are reachable two ways:

```typescript
// 1. Instance methods on a view - the native String method surface.
const v = str.from("hello, world");
v.slice(7).toUpperCase(); // "WORLD"

// 2. Free functions - take a `string` OR a `str` as the first argument.
str.slice("hello, world", 7); // str
str.indexOf("hello, world", "world"); // 7
str.toUpperCase("hello"); // "HELLO" (allocates)
```

Convert a `string` to a view with **`str.from(s)`** (or `new str(data, start,
end)` from explicit bounds).

## Performance

📊 **[Browse the full chart set for this release →](https://github.com/JairusSW/str-as/tree/docs/charts/v0.1.1)**

### Per-Operation Speedup

Every native `String` operation vs its `str` counterpart - native (red) is
the `1×` baseline, `str` (blue) is its speedup:

<img src="https://raw.githubusercontent.com/JairusSW/str-as/refs/heads/docs/charts/v0.1.1/per-op-speedup.svg" alt="Every String operation vs its str counterpart">

### Throughput

Native vs `str` SWAR vs `str` SIMD, in millions of ops/sec:

<img src="https://raw.githubusercontent.com/JairusSW/str-as/refs/heads/docs/charts/v0.1.1/throughput.svg" alt="String operation throughput: native vs SWAR vs SIMD">

### SWAR and SIMD

The scanning hot paths are accelerated in three tiers, chosen at **compile
time**:

- **SIMD** - 8 code units per step via `v128`, used when `--enable simd` is set
  (`ASC_FEATURE_SIMD`).
- **SWAR** - *SIMD-Within-A-Register*: 4 code units per step with ordinary `u64`
  math. The default when SIMD is off.
- **scalar** - handles the short sub-block tail.

When SIMD is off the entire `v128` branch is dead-code-eliminated, and vice
versa, so you only pay for the tier you build. Wide loads are always bounded by
the remaining length, so they never read past the backing string - no scratch
padding. Both builds are covered by the test suite (run under two modes) and by
differential fuzzing against the native `String` methods.

### Running Benchmarks Locally

```bash
npm run bench         # microbenchmarks (as-bench)
npm run charts:build  # benchmark both builds and render charts to build/charts/
npm run charts        # build the charts and serve them locally
```

## Architecture

A `str` is a 3-field view - `data: string` (the GC owner), and `start` /
`end` raw byte pointers into that string's UTF-16 data. Every op moves the
pointers; bytes are copied only by `toString()` (and the allocating ops, which
build their result in one pass).

- **Single source of truth.** Instance methods and the `str.*` free
  functions both funnel through `*Range` static helpers that operate on raw
  `(data, start, end)` bounds - so a view-producing op is exactly one allocation
  (the result) and a query is zero.
- **Accelerated primitives.** `findUnit` (powers `indexOf`/`includes`/
  `lastIndexOf`) and `compare` carry SIMD / SWAR / scalar tiers; `copyBytes` and
  `equalsBytes` use a size-tiered manual loop that beats the bulk-memory
  intrinsics on small/medium ranges.
- **Native parity.** Semantics mirror AssemblyScript's `String` (not JS) and are
  verified bit-for-bit by differential fuzzing across both SIMD and SWAR builds.
- **GC-safe.** A view keeps its backing string reachable through `data`, and
  views of views anchor to the original - so chains of slices never pin
  intermediate allocations and the underlying bytes are never collected while a
  view is alive.

## Contributing

Contributions are welcome. To work on `str`:

```bash
npm install
npm test          # spec suite (as-test), under simd + nosimd modes
npm run test:fuzz # differential fuzzing vs native String
npm run check     # lint + typecheck
```

## License

This project is distributed under an open source license. Work on this project
is done by passion, but if you want to support it financially, you can do so by
making a donation to the project's [GitHub Sponsors](https://github.com/sponsors/JairusSW)
page.

You can view the full license here: [License](./LICENSE)

## Contact

Please send all issues to [GitHub Issues](https://github.com/JairusSW/str-as/issues),
and to converse, send me an email at [me@jairus.dev](mailto:me@jairus.dev).

- **Email:** Send me inquiries, questions, or requests at [me@jairus.dev](mailto:me@jairus.dev)
- **GitHub:** Visit the official GitHub repository [Here](https://github.com/JairusSW/str-as)
- **Website:** Visit my official website at [jairus.dev](https://jairus.dev/)
- **Discord:** Contact me at [My Discord](https://discord.com/users/600700584038760448) or on the [AssemblyScript Discord Server](https://discord.gg/assemblyscript/)
