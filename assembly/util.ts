// Low-level, allocation-free helpers shared by the vstring core. Everything
// here works on raw byte pointers into UTF-16 string data (2 bytes per code
// unit) so that views never copy until a real `string` is materialized.
//
// The scanning primitives (`findUnit`, `compare`) carry three tiers:
//
//   * SIMD   - 8 code units (16 bytes) per step via v128, taken only when
//     `ASC_FEATURE_SIMD` is compiled in (`--enable simd`); otherwise the whole
//     branch is folded away at compile time.
//   * SWAR   - 4 code units (8 bytes) per step using plain u64 word tricks; the
//     default fast path when SIMD is off.
//   * scalar - one code unit at a time, handling the sub-block tail.
//
// Wide loads are always gated by the remaining length (`p + block <= end`), so
// they never read past the end of the backing string allocation - no scratch
// padding is required. UTF-16 data is 2-byte aligned; wider unaligned loads are
// well-defined in WebAssembly.

// Per-16-bit-lane constants for the SWAR zero/diff detection (Mycroft's trick).
const LANE_ONES: u64 = 0x0001000100010001;
const LANE_HIGH: u64 = 0x8000800080008000;

/** Number of UTF-16 code units spanned by a `[start, end)` byte range. */
// @ts-ignore: decorator
@inline export function unitLength(start: usize, end: usize): i32 {
  return <i32>((end - start) >> 1);
}

/**
 * Find the first code unit equal to `needle` in `[start, end)`. Returns its
 * code-unit offset from `start`, or `-1`. This is the workhorse behind
 * `indexOf`: it locates candidate match positions far faster than a scalar scan.
 */
export function findUnit(start: usize, end: usize, needle: u16): i32 {
  let p = start;
  if (ASC_FEATURE_SIMD) {
    const splat = i16x8.splat(<i16>needle);
    while (p + 16 <= end) {
      const mask = i16x8.bitmask(i16x8.eq(v128.load(p), splat));
      if (mask) return <i32>((p - start) >> 1) + ctz(mask);
      p += 16;
    }
  } else {
    const bcast = <u64>needle * LANE_ONES;
    while (p + 8 <= end) {
      const x = load<u64>(p) ^ bcast;
      const t = (x - LANE_ONES) & ~x & LANE_HIGH;
      if (t) return <i32>((p - start) >> 1) + <i32>(ctz(t) >> 4);
      p += 8;
    }
  }
  while (p < end) {
    if (load<u16>(p) == needle) return <i32>((p - start) >> 1);
    p += 2;
  }
  return -1;
}

/** Lexicographic compare of two code-unit ranges (like `String.prototype.<`). */
export function compare(
  aStart: usize,
  aEnd: usize,
  bStart: usize,
  bEnd: usize,
): i32 {
  const aLen = unitLength(aStart, aEnd);
  const bLen = unitLength(bStart, bEnd);
  let rem = aLen < bLen ? aLen : bLen;
  let pa = aStart;
  let pb = bStart;

  if (ASC_FEATURE_SIMD) {
    while (rem >= 8) {
      const eq = i16x8.bitmask(i16x8.eq(v128.load(pa), v128.load(pb))) & 0xff;
      if (eq != 0xff) {
        const lane = (<usize>ctz(~eq & 0xff)) << 1;
        const ca = load<u16>(pa + lane);
        const cb = load<u16>(pb + lane);
        return ca < cb ? -1 : 1;
      }
      pa += 16;
      pb += 16;
      rem -= 8;
    }
  } else {
    while (rem >= 4) {
      const wa = load<u64>(pa);
      const wb = load<u64>(pb);
      if (wa != wb) {
        const lane = (<usize>(ctz(wa ^ wb) >> 4)) << 1;
        const ca = load<u16>(pa + lane);
        const cb = load<u16>(pb + lane);
        return ca < cb ? -1 : 1;
      }
      pa += 8;
      pb += 8;
      rem -= 4;
    }
  }

  while (rem > 0) {
    const ca = load<u16>(pa);
    const cb = load<u16>(pb);
    if (ca != cb) return ca < cb ? -1 : 1;
    pa += 2;
    pb += 2;
    rem--;
  }
  return aLen == bLen ? 0 : aLen < bLen ? -1 : 1;
}

// Above this many bytes `memory.compare` (optimized native memcmp) wins; below
// it, a manual equality scan avoids its per-call overhead and needs no ordering.
const COMPARE_INTRINSIC_MIN: usize = 256;

/**
 * Whether `n` bytes at `a` and `b` are identical. Small ranges use a manual
 * scan (v128 blocks under SIMD, else u64, then a scalar tail) that early-exits
 * on the first mismatch and never computes ordering; large ranges defer to
 * `memory.compare`. Pointers are at least 2-byte aligned.
 */
export function equalsBytes(a: usize, b: usize, n: usize): bool {
  if (n >= COMPARE_INTRINSIC_MIN) return memory.compare(a, b, n) == 0;
  let i: usize = 0;
  if (ASC_FEATURE_SIMD) {
    for (; i + 16 <= n; i += 16) {
      if (v128.any_true(v128.xor(v128.load(a + i), v128.load(b + i)))) {
        return false;
      }
    }
  }
  for (; i + 8 <= n; i += 8) {
    if (load<u64>(a + i) != load<u64>(b + i)) return false;
  }
  if (i + 4 <= n) {
    if (load<u32>(a + i) != load<u32>(b + i)) return false;
    i += 4;
  }
  if (i + 2 <= n) {
    if (load<u16>(a + i) != load<u16>(b + i)) return false;
    i += 2;
  }
  if (i < n) return load<u8>(a + i) == load<u8>(b + i);
  return true;
}

/** Byte-exact equality of two code-unit ranges. */
export function equals(
  aStart: usize,
  aEnd: usize,
  bStart: usize,
  bEnd: usize,
): bool {
  const aBytes = aEnd - aStart;
  if (aBytes != bEnd - bStart) return false;
  return equalsBytes(aStart, bStart, aBytes);
}

/**
 * Find the first occurrence of the needle range inside the haystack range,
 * starting at code-unit offset `from`. Returns the code-unit index or `-1`.
 *
 * `findUnit` (SIMD/SWAR) jumps straight to each position where the needle's
 * first unit appears; the remaining units are verified with `equalsBytes`. For
 * a single-unit needle this is a pure accelerated scan.
 */
export function indexOf(
  hStart: usize,
  hEnd: usize,
  nStart: usize,
  nEnd: usize,
  from: i32,
): i32 {
  const hLen = unitLength(hStart, hEnd);
  const nLen = unitLength(nStart, nEnd);
  // Mirror AssemblyScript's `String#indexOf`: an empty needle is always found
  // at offset 0, regardless of `from`.
  if (nLen == 0) return 0;
  if (nLen > hLen) return -1;

  const first = load<u16>(nStart);
  const last = hLen - nLen;
  // The first unit can only start a valid match at indices `[from, last]`.
  const scanEnd = hStart + ((<usize>(last + 1)) << 1);
  const tailBytes = (<usize>(nLen - 1)) << 1;
  let i = max(from, 0);

  while (i <= last) {
    const rel = findUnit(hStart + ((<usize>i) << 1), scanEnd, first);
    if (rel < 0) return -1;
    i += rel;
    if (
      nLen == 1 ||
      equalsBytes(hStart + ((<usize>(i + 1)) << 1), nStart + 2, tailBytes)
    ) {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Find the last occurrence at or before code-unit offset `from`. The backward
 * first-unit scan stays scalar (reverse vectorization buys little here), but
 * each candidate's tail is verified with `equalsBytes`.
 */
export function lastIndexOf(
  hStart: usize,
  hEnd: usize,
  nStart: usize,
  nEnd: usize,
  from: i32,
): i32 {
  const hLen = unitLength(hStart, hEnd);
  const nLen = unitLength(nStart, nEnd);
  // Mirror AssemblyScript's `String#lastIndexOf`: an empty needle always
  // matches at the end of the string, regardless of `from`.
  if (nLen == 0) return hLen;
  if (nLen > hLen) return -1;

  const first = load<u16>(nStart);
  const tailBytes = (<usize>(nLen - 1)) << 1;
  // Native clamps a negative `from` to 0 (the highest index to search).
  for (let i = min(max(from, 0), hLen - nLen); i >= 0; i--) {
    if (load<u16>(hStart + ((<usize>i) << 1)) != first) continue;
    if (
      nLen == 1 ||
      equalsBytes(hStart + ((<usize>(i + 1)) << 1), nStart + 2, tailBytes)
    ) {
      return i;
    }
  }
  return -1;
}

// Above this many bytes the `memory.copy` bulk-memory intrinsic (an optimized
// native memcpy) wins; below it, its fixed per-call setup dominates and a manual
// unrolled copy is faster. Tiny copies - e.g. a pad fill repeating a 1-char
// string - are where the manual path pays off the most.
const COPY_INTRINSIC_MIN: usize = 256;

/**
 * Copy `n` bytes from `src` to `dst` (non-overlapping). Small copies use a
 * manual tiered loop (v128 blocks when SIMD is compiled in, else u64, then a
 * scalar tail); large copies defer to `memory.copy`. Pointers are at least
 * 2-byte aligned; wider unaligned loads/stores are well-defined in Wasm.
 */
export function copyBytes(dst: usize, src: usize, n: usize): void {
  if (n >= COPY_INTRINSIC_MIN) {
    memory.copy(dst, src, n);
    return;
  }
  let i: usize = 0;
  if (ASC_FEATURE_SIMD) {
    for (; i + 16 <= n; i += 16) {
      v128.store(dst + i, v128.load(src + i));
    }
  }
  for (; i + 8 <= n; i += 8) {
    store<u64>(dst + i, load<u64>(src + i));
  }
  if (i + 4 <= n) {
    store<u32>(dst + i, load<u32>(src + i));
    i += 4;
  }
  if (i + 2 <= n) {
    store<u16>(dst + i, load<u16>(src + i));
    i += 2;
  }
  if (i < n) store<u8>(dst + i, load<u8>(src + i));
}

/** Allocate an uninitialized `string` of `bytes` bytes (2 per code unit). */
// @ts-ignore: decorator
@inline export function allocString(bytes: usize): string {
  return changetype<string>(__new(bytes, idof<string>()));
}

/** Allocate a fresh `string` and copy `[start, end)` bytes into it. */
export function materialize(start: usize, end: usize): string {
  const bytes = <usize>(end - start);
  if (!bytes) return "";
  const out = allocString(bytes);
  copyBytes(changetype<usize>(out), start, bytes);
  return out;
}

// Whitespace + line-terminator set used by `trim` family, matching the code
// units AssemblyScript's own `String#trim` treats as trimmable.
// @ts-ignore: decorator
@inline export function isWhiteSpace(c: u16): bool {
  switch (c) {
    case 0x09: // tab
    case 0x0a: // LF
    case 0x0b: // VT
    case 0x0c: // FF
    case 0x0d: // CR
    case 0x20: // space
    case 0x85: // NEL
    case 0xa0: // NBSP
    case 0x1680:
    case 0x2000:
    case 0x2001:
    case 0x2002:
    case 0x2003:
    case 0x2004:
    case 0x2005:
    case 0x2006:
    case 0x2007:
    case 0x2008:
    case 0x2009:
    case 0x200a:
    case 0x2028: // LS
    case 0x2029: // PS
    case 0x202f:
    case 0x205f:
    case 0x3000:
    case 0xfeff: // BOM / ZWNBSP
      return true;
    default:
      return false;
  }
}
