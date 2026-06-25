// Low-level UTF-16 helpers for `str`. Scans use SIMD, SWAR, then scalar tails.

// Per-16-bit-lane constants for the SWAR zero/diff detection (Mycroft's trick).
const LANE_ONES: u64 = 0x0001000100010001;
const LANE_HIGH: u64 = 0x8000800080008000;

// Lazy so no-SIMD builds never emit the splat initializer.
// @ts-ignore: decorator
@lazy const NON_ASCII_MASK: v128 = i16x8.splat(<i16>0xff80);

/** Number of UTF-16 code units spanned by a `[start, end)` byte range. */
// @ts-ignore: decorator
@inline export function unitLength(start: usize, end: usize): i32 {
  return <i32>((end - start) >> 1);
}

/** Find `needle` in `[start, end)`, returning its code-unit offset or `-1`. */
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

// Below this, manual equality avoids `memory.compare` overhead.
const COMPARE_INTRINSIC_MIN: usize = 256;

/** Byte equality for two ranges, using manual scans for small inputs. */
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

/** Find the first needle range in the haystack, returning a code-unit index. */
export function indexOf(
  hStart: usize,
  hEnd: usize,
  nStart: usize,
  nEnd: usize,
  from: i32,
): i32 {
  const hLen = unitLength(hStart, hEnd);
  const nLen = unitLength(nStart, nEnd);
  // Empty needles match at 0, matching AssemblyScript.
  if (nLen == 0) return 0;
  if (nLen > hLen) return -1;

  const first = load<u16>(nStart);
  const last = hLen - nLen;
  // First unit can only start a match at `[from, last]`.
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

/** Find the last needle range at or before `from`. */
export function lastIndexOf(
  hStart: usize,
  hEnd: usize,
  nStart: usize,
  nEnd: usize,
  from: i32,
): i32 {
  const hLen = unitLength(hStart, hEnd);
  const nLen = unitLength(nStart, nEnd);
  // Empty needles match at the end, matching AssemblyScript.
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

// Below this, manual copy avoids `memory.copy` overhead.
const COPY_INTRINSIC_MIN: usize = 256;

/** Copy `n` non-overlapping bytes from `src` to `dst`. */
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

/**
 * Whether every UTF-16 code unit in `[start, end)` is ASCII (below U+0080).
 * Scans 8 units (16 bytes) at a time under SIMD, 4 under SWAR, then a scalar
 * tail. Lets the case-fold family take an allocation-light byte fast path.
 */
export function isAsciiRange(start: usize, end: usize): bool {
  let p = start;
  if (ASC_FEATURE_SIMD) {
    while (p + 16 <= end) {
      if (v128.any_true(v128.and(v128.load(p), NON_ASCII_MASK))) return false;
      p += 16;
    }
  } else {
    while (p + 8 <= end) {
      if (load<u64>(p) & 0xff80ff80ff80ff80) return false;
      p += 8;
    }
  }
  while (p < end) {
    if (load<u16>(p) >= 0x80) return false;
    p += 2;
  }
  return true;
}

/**
 * Copy `n` bytes of ASCII UTF-16 from `src` to `dst`, adding `delta` to each
 * code unit in `[lo, hi]`. With `lo='a',hi='z',delta=-0x20` this upper-cases;
 * with `lo='A',hi='Z',delta=+0x20` it lower-cases. Callers must ensure the range
 * is pure ASCII (see `isAsciiRange`). Folds 8 units per step under SIMD, 4 under
 * SWAR, then a scalar tail. Non-overlapping.
 */
export function asciiCaseFold(
  dst: usize,
  src: usize,
  n: usize,
  lo: u16,
  hi: u16,
  delta: i32,
): void {
  let i: usize = 0;
  if (ASC_FEATURE_SIMD) {
    const vlo = i16x8.splat(<i16>lo);
    const vhi = i16x8.splat(<i16>hi);
    const vd = i16x8.splat(<i16>delta);
    for (; i + 16 <= n; i += 16) {
      const va = v128.load(src + i);
      const inRange = v128.and(i16x8.ge_s(va, vlo), i16x8.le_s(va, vhi));
      v128.store(dst + i, i16x8.add(va, v128.and(inRange, vd)));
    }
  }
  // SWAR: per-lane range test with no cross-lane carry (ASCII units are < 0x80,
  // so `unit + bGe` stays within its 16-bit lane). `m` carries 0x8000 in each
  // in-range lane; `m >> 10` turns that into the 0x20 case-fold bit.
  const bGe = <u64>(0x8000 - <i32>lo) * LANE_ONES;
  const bLt = <u64>(0x8000 - (<i32>hi + 1)) * LANE_ONES;
  const sub = delta < 0;
  for (; i + 8 <= n; i += 8) {
    const w = load<u64>(src + i);
    const fold = ((w + bGe) & ~(w + bLt) & LANE_HIGH) >> 10;
    store<u64>(dst + i, sub ? w - fold : w + fold);
  }
  for (; i < n; i += 2) {
    const c = load<u16>(src + i);
    store<u16>(dst + i, <u16>(c >= lo && c <= hi ? <i32>c + delta : <i32>c));
  }
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
