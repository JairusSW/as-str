# Automatic Native String to `str` View Optimization

## Goal

Extend the existing `as-str` transform so it can track native AssemblyScript
`string` values, identify values that can safely use the zero-copy `str` view,
and insert conversions between the two representations without changing program
behavior.

In this document:

- **native string** means AssemblyScript's built-in `string` type.
- **view** means this package's UTF-16 `str` / `Str` type.

The optimizer must be conservative. If it cannot prove that changing a value's
representation is safe and profitable, the value remains a native string.

## Requirements

1. Track every native-string and view-producing expression, binding, parameter,
   field, and return value in user code.
2. Promote native strings to views when doing so removes an allocation or keeps
   an existing view from being materialized.
3. Insert native-string-to-view and view-to-native conversions at safe typed
   boundaries.
4. Propagate views through assignments, branches, loops, and internal function
   calls when every relevant use is known.
5. Never promote values whose native representation is observed or whose uses
   cannot be proven safe.
6. Preserve exported and external ABI signatures by default.
7. Explain optimization and rejection decisions through deterministic debug
   diagnostics.

## Important semantic distinction

Native strings are immutable, so "the string is not modified" is not quite the
right safety rule. A variable may be reassigned and still be safely represented
as a view if every value reaching it and every use of it is view-compatible.

The actual safety question is whether the native representation is observed or
escapes. Pointer casts, raw memory operations, unknown calls, external APIs, and
native-typed containers are representation-sensitive even if the string's
contents are never modified.

Promotion should also be profitable. Wrapping an otherwise untouched native
string in a `Str` object adds an allocation without eliminating a native string
allocation. The transform should track all strings but only promote candidates
that eliminate materialization or a native substring-like allocation.

## Compiler architecture

The current transform operates in `afterParse` and injects the `str` import.
AssemblyScript does not expose resolved types at that stage. Types become
available in `afterInitialize`, after the program has already been initialized
from the AST, so rewriting types and expressions there is too late for a normal
compilation.

The recommended architecture therefore has two optimization modes.

### Conservative transform mode

Continue supporting the normal invocation:

```sh
asc input.ts --transform as-str
```

During `afterParse`, the transform can safely optimize cases determined from
explicit declarations, locally resolved bindings, literals, known operations,
and known function signatures. Unknown or ambiguous cases stay native.

### Type-aware whole-program mode

Provide a small compiler wrapper, tentatively named `as-strc`, that runs two
passes:

```text
Original sources
      |
      v
Pass 1: initialize and type-check
      |
      +-- collect string types, call targets, flows, and hazards
      v
Optimization manifest
      |
      v
Pass 2: rewrite during afterParse
      |
      v
Normal AssemblyScript compilation
```

Before committing to the wrapper, perform a feasibility spike against
AssemblyScript 0.28.18 to determine exactly which expression types and resolved
call targets are available from the initialized `Program`. If the public API is
insufficient, prefer conservative AST analysis over tightly coupling the
package to private compiler internals. A compiler fork or upstream compiler
change is a last resort.

The existing transform remains the public entry point and owns import injection
and pass-two rewriting. The wrapper only supplies the semantic manifest needed
for more complete decisions.

## Analysis model

Create one fact record for every relevant expression and binding. Each record
tracks:

- Declaration and source range.
- Declared and inferred type.
- Initializer and subsequent assignments.
- Reads, writes, and aliases.
- Function arguments and return flows.
- Container and field storage.
- Native-string and view operations performed.
- Escape and unsafe reasons.
- Profitability evidence.
- Final representation decision.
- Conversions inserted by rewriting.

Use a small representation lattice:

```text
Unknown
  |-- NativeCandidate
  |-- ViewCandidate
  |-- View
  `-- ForcedNative
```

`ForcedNative` is absorbing. Once an operation observes a native string's
representation, the affected binding remains native unless a future, more
precise analysis can split the binding into independent SSA-like values.

Run analysis as a fixed point:

1. Collect modules, imports, declarations, functions, and lexical scopes.
2. Resolve identifier references and locally known call targets.
3. Seed native-string literals, native-producing calls, and existing views.
4. Propagate representation requirements through assignments and returns.
5. Analyze function-call strongly connected components so recursive functions
   stabilize.
6. Mark raw-memory, ABI, unknown-call, and container barriers.
7. Compute whether each remaining candidate is profitable.
8. Select representations and required boundary conversions.
9. Validate the rewritten flow graph before compilation continues.

## View-producing operations

Initial promotion should focus on native operations where a `str` implementation
can avoid copying:

- `slice`
- `substring`
- `substr`
- `trim`, `trimStart`, and `trimEnd`
- `trimLeft` and `trimRight`
- `charAt`
- `at`
- `before`, `after`, and `between`
- `beforeLast`, `afterLast`, and `betweenLast`

For example:

```ts
const path = input.slice(4, 12);
return path.length;
```

can become approximately:

```ts
const path: str = str.slice(input, 4, 12);
return path.length;
```

Chains should stay views until they reach a native boundary:

```ts
const name = input.trim().slice(0, 10);
```

can become approximately:

```ts
const name: str = str.trim(input).slice(0, 10);
```

Maintain a method-semantics table that classifies every supported `String` and
`Str` operation as one of:

- View-producing.
- Native-string-producing.
- Scalar-producing.
- Representation-sensitive.
- Unsupported or unknown.

Keep this table aligned with `assembly/str.ts`, ideally with a test that detects
API drift.

## Seamless conversion rules

Use these conversion rules at proven-safe typed boundaries:

| Actual representation | Expected representation | Rewrite |
| --- | --- | --- |
| native `string` | `str` | `str.from(value)` |
| `str` | native `string` | `value.toString()` |
| native `string` | native `string` | none |
| `str` | `str` | none |

Apply conversions to:

- Typed variable initializers.
- Assignments.
- Returns.
- Arguments to statically known functions.
- Conditional branches and merge points.
- Internal parameters promoted from native string to view.

Remove redundant round trips such as:

```ts
str.from(view.toString())
view.toString() // followed immediately by a safe re-wrap
```

Improve `Str.toString()` so a view covering its entire backing string returns
`data` directly. The current `materialize` path always creates and copies a new
native string. A full-range fast path makes native-to-view-to-native round trips
allocation-free while preserving behavior because strings are immutable.

## Internal function specialization

An internal parameter may change from native `string` to `str` only when:

- The function body is completely view-safe.
- Every direct and indirect call site is known.
- Every argument can remain or become a view safely.
- The function is not exported, external, imported, virtual, overridden,
  interface-constrained, or used as an unresolved callback.

For example:

```ts
function parse(value: string): i32 {
  return value.slice(1).length;
}
```

may become:

```ts
function parse(value: str): i32 {
  return value.slice(1).length;
}
```

Analyze mutually recursive functions as a strongly connected component. If one
member has an unsafe boundary, conservatively reject signature promotion for the
affected flow through the component.

Exported and external signatures remain native unless a future explicit ABI
mode is introduced. A view inside such a function may still be optimized as a
local temporary.

## Native and unsafe barriers

Leave a binding native if any use observes native representation or cannot be
proven view-safe.

Hard barriers include:

- `changetype<usize>(value)` and other pointer conversions.
- `load<string>()`, `store<string>()`, and related direct memory operations.
- Explicit prefix assertions or `as` casts involving `string` or `str`.
- Passing the value to a function with a native `string` parameter when the
  request is to avoid hidden boundary materialization.
- Imported, external, exported, indirect, overloaded-but-unresolved, or unknown
  calls.
- Storage in `Array<string>`, native-string object fields, maps, sets, tuples,
  or generic containers unless the complete container is also safely rewritten.
- Returning from an exported or public native-string API.
- Closure capture until closure escape analysis is implemented.
- Nullable native strings during the first implementation.
- Template literals, concatenation, and mixed `string` / `str` operators until
  evaluation order and overload behavior have dedicated coverage.
- Compiler and runtime intrinsics such as `idof`, `offsetof`, `__pin`,
  `__unpin`, `__new`, or unknown generic built-ins when a string flows through
  them.

For example, this call keeps `someString` native by default:

```ts
function foo(bar: string): void {}
foo(someString);
```

Materializing a view at the call could be semantically correct, but it would add
a hidden allocation at the exact boundary where the optimization cannot help.
The conservative decision is to keep the upstream value native.

Explicit user intent should take priority. AssemblyScript does not permit
decorators on local variables, so use transform-recognized comment pragmas:

```ts
// @as-str no-view
let pointerSensitive: string = source;

// @as-str prefer-view
let token = source.slice(1);
```

`no-view` is an unconditional barrier. `prefer-view` requests promotion but
must produce a useful diagnostic instead of overriding a safety failure.

## Suggested transform layout

Refactor the transform into focused modules rather than expanding the existing
entry point into a single visitor:

```text
transform/src/
  index.ts             public transform and lifecycle orchestration
  imports.ts           existing automatic import injection
  collect.ts           scope, declaration, and binding collection
  symbols.ts           identifier and call-target resolution
  facts.ts             representation lattice and fact records
  operations.ts        String/Str method semantics and profitability table
  analyze.ts           local data-flow and safety analysis
  interprocedural.ts   call graph, SCCs, parameters, and returns
  rewrite.ts           AST type and expression rewrites
  conversions.ts       boundary conversion insertion and deduplication
  diagnostics.ts       deterministic decisions and rejection reasons
  manifest.ts          type-aware first-pass manifest format
```

Avoid using source-text regular expressions for semantic decisions. The current
regex can remain temporarily for fast import detection, but optimization must
operate on AST nodes and lexical bindings so comments, shadowing, aliases, and
nested scopes are handled correctly.

## Implementation phases

### Phase 0: feasibility and specification

- Probe AssemblyScript 0.28.18's initialized `Program` API.
- Determine whether expression types and resolved calls can be recorded without
  importing private compiler internals.
- Create minimal compile fixtures for every required positive and negative case.
- Specify exact conversion, ABI, and evaluation-order behavior.
- Decide whether full mode requires the `as-strc` two-pass wrapper.

Exit criterion: a documented architecture choice supported by working compiler
API experiments.

### Phase 1: transform refactor

- Separate existing import injection from optimization code.
- Add reusable AST traversal and lexical-scope helpers.
- Preserve current output exactly while optimization is disabled.
- Add transform-specific unit tests for existing import behavior.

Exit criterion: no behavior change and all existing checks pass.

### Phase 2: analysis-only mode

- Collect all native string and view facts without rewriting.
- Implement the representation lattice and local fixed-point propagation.
- Classify known string operations and unsafe boundaries.
- Emit deterministic diagnostics containing source location, decision, and
  reason.

Exit criterion: every fixture has the expected candidate or rejection reason.

### Phase 3: conservative local promotion

- Rewrite local view-producing operations.
- Support typed initializers and assignments.
- Propagate views through straight-line code, branches, loops, and chains.
- Insert proven-safe native/view conversions.
- Add the full-range `Str.toString()` fast path.
- Deduplicate redundant conversions.

Exit criterion: positive fixtures eliminate expected native allocations and all
unsafe fixtures remain unchanged.

### Phase 4: interprocedural optimization

- Build the internal call graph.
- Propagate parameter and return representation requirements.
- Rewrite safe private/internal signatures.
- Handle recursion through SCC fixed points.
- Preserve all public, exported, imported, virtual, and external ABIs.

Exit criterion: internal-call fixtures optimize without changing externally
visible signatures.

### Phase 5: type-aware whole-program mode

- Implement the first-pass semantic manifest if the feasibility spike supports
  it.
- Implement or package the `as-strc` wrapper.
- Match manifest facts back to second-pass AST nodes robustly using normalized
  source paths and stable ranges/identifiers.
- Fall back to native representation when sources or manifest entries do not
  match exactly.

Exit criterion: inferred and cross-module cases optimize with the same safety
properties as explicitly typed local cases.

### Phase 6: profitability and rollout

- Estimate allocations removed versus view objects and conversions introduced.
- Reject transformations with no expected allocation benefit.
- Add summary diagnostics for optimized bindings and eliminated materialization.
- Initially gate optimization behind `AS_STR_OPTIMIZE=1`.
- Keep detailed decisions available through `STR_AS_DEBUG`.
- Make conservative mode the default only after differential testing and
  real-project trials are clean.

Exit criterion: stable behavior, measurable wins, and no unexplained rewrites.

## Test strategy

Add a transform fixture harness that compiles each case with optimization both
disabled and enabled, executes both Wasm modules, and compares observable
results.

Positive coverage:

- Every view-producing operation.
- Native-to-view and view-to-native typed assignments.
- View chains with scalar consumers.
- Internal parameters and returns.
- Branches, loops, reassignment, aliases, and recursion.
- Full-range view round trips.
- Existing explicit `str` values mixed with optimized native strings.

Negative coverage:

- `load<string>()` and `store<string>()`.
- `changetype<usize>(string)` and related casts.
- Prefix and `as` assertions.
- Native-string function arguments.
- Imported, exported, external, virtual, callback, and indirect calls.
- Arrays, fields, maps, sets, generics, and nullable strings.
- Templates and concatenation.
- Shadowed `string`, `String`, `str`, and imported aliases.
- Side-effecting receivers and arguments to verify evaluation order.

Infrastructure coverage:

- Transform with and without an explicit `str` import.
- Installed-package and in-repository import paths.
- Debug diagnostics and stable rejection reasons.
- Method-semantics table parity with `Str`.
- Both SIMD and non-SIMD test modes already used by the repository.

Performance verification should use at least one of:

- Allocation counters in purpose-built fixtures.
- WAT inspection showing eliminated native string allocation/copy paths.
- Benchmarks comparing native substrings, conservative promotion, and full
  type-aware promotion.

## Acceptance criteria

- Optimized and unoptimized builds produce identical observable behavior.
- Every hard-barrier fixture remains native.
- Selected slice, substring, trim, and chaining fixtures demonstrably eliminate
  native string allocations.
- No redundant `str.from(x).toString()` or equivalent conversion chains remain.
- Externally visible function and data-layout ABIs remain unchanged by default.
- Every rejected candidate has a deterministic, actionable debug reason.
- Existing `str`, `str8`, fuzz, typecheck, lint, and transform tests pass.
- Optimization is conservative on compiler constructs it does not understand.

## Recommended delivery order

Deliver conservative local promotion first. It provides useful zero-copy wins
for substring-like temporaries while remaining compatible with the existing
transform interface. Add interprocedural and two-pass type-aware optimization
only after the local safety model, diagnostics, and differential test harness
are stable.

This order keeps correctness as the hard constraint while allowing the package
to gain measurable value before solving every whole-program inference case.
