// Low-level UTF-16 helpers for `str`. Scans use SIMD, SWAR, then scalar tails.
import { OBJECT_MAXSIZE } from "rt/common";
import { UTF8 as U8 } from "utf-as";

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
    if (p + 16 <= end) {
      const splat = i16x8.splat(<i16>needle);
      let mask = 0;
      do {
        mask = i16x8.bitmask(i16x8.eq(v128.load(p), splat));
        if (mask) break;
        p += 16;
      } while (p + 16 <= end);
      // Keep position calculation outside the loop: otherwise the optimizer
      // can emit ctz and offset arithmetic for every nonmatching block.
      if (mask) return <i32>((p - start) >> 1) + ctz(mask);
    }
  } else {
    if (p + 8 <= end) {
      const bcast = <u64>needle * LANE_ONES;
      let mask: u64 = 0;
      do {
        const x = load<u64>(p) ^ bcast;
        mask = (x - LANE_ONES) & ~x & LANE_HIGH;
        if (mask) break;
        p += 8;
      } while (p + 8 <= end);
      if (mask) return <i32>((p - start) >> 1) + <i32>(ctz(mask) >> 4);
    }
  }
  while (p < end) {
    if (load<u16>(p) == needle) return <i32>((p - start) >> 1);
    p += 2;
  }
  return -1;
}

/** Find the last matching code unit without reading outside `[start, end)`. */
export function findLastUnit(start: usize, end: usize, needle: u16): i32 {
  let p = end;
  if (ASC_FEATURE_SIMD) {
    const splat = i16x8.splat(<i16>needle);
    while (p - start >= 16) {
      p -= 16;
      const mask = i16x8.bitmask(i16x8.eq(v128.load(p), splat));
      if (mask) return <i32>((p - start) >> 1) + 31 - clz(mask);
    }
  } else {
    const bcast = <u64>needle * LANE_ONES;
    while (p - start >= 8) {
      p -= 8;
      const mask = zeroUnitMask(load<u64>(p) ^ bcast);
      if (mask) return <i32>((p - start) >> 1) + 3 - <i32>(clz(mask) >> 4);
    }
  }
  while (p > start) {
    p -= 2;
    if (load<u16>(p) == needle) return <i32>((p - start) >> 1);
  }
  return -1;
}

// Unlike Mycroft's forward-search mask, this has no borrow-induced false
// positives in higher lanes, so selecting its highest matching lane is safe.
// @ts-ignore: decorator
@inline function zeroUnitMask(x: u64): u64 {
  const low = ~LANE_HIGH;
  return ~(((x & low) + low) | x | low);
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
  // Overlapping loads cover short ranges without a loop or scalar tail. Each
  // load stays inside the range, including unaligned views at the memory end.
  if (n < 8) {
    if (n >= 4) {
      return (
        ((load<u32>(a) ^ load<u32>(b)) |
          (load<u32>(a + n - 4) ^ load<u32>(b + n - 4))) ==
        0
      );
    }
    if (n >= 2) {
      return (
        ((load<u16>(a) ^ load<u16>(b)) |
          (load<u16>(a + n - 2) ^ load<u16>(b + n - 2))) ==
        0
      );
    }
    return n == 0 || load<u8>(a) == load<u8>(b);
  }
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
  if (i > last) return -1;
  if (nLen == 2 && last - i < 16) {
    const pair = load<u32>(nStart);
    for (; i <= last; i++) {
      if (load<u32>(hStart + ((<usize>i) << 1)) == pair) return i;
    }
    return -1;
  }
  const rel = findUnit(hStart + ((<usize>i) << 1), scanEnd, first);
  if (rel < 0) return -1;
  i += rel;
  if (
    nLen == 1 ||
    equalsBytes(hStart + ((<usize>(i + 1)) << 1), nStart + 2, tailBytes)
  ) {
    return i;
  }
  return indexOfRemainder(hStart, nStart, nLen, i + 1, last);
}

// Keep failed-candidate bookkeeping out of the common first-match path.
function indexOfRemainder(
  hStart: usize,
  nStart: usize,
  nLen: i32,
  i: i32,
  last: i32,
): i32 {
  const first = load<u16>(nStart);
  const scanEnd = hStart + ((<usize>(last + 1)) << 1);
  const tailBytes = (<usize>(nLen - 1)) << 1;
  if (last - i < 16) {
    for (; i <= last; i++) {
      const p = hStart + ((<usize>i) << 1);
      if (load<u16>(p) == first && equalsBytes(p + 2, nStart + 2, tailBytes)) {
        return i;
      }
    }
    return -1;
  }
  let windowStart = i - 1;
  let failures = 1;

  while (i <= last) {
    const rel = findUnit(hStart + ((<usize>i) << 1), scanEnd, first);
    if (rel < 0) return -1;
    i += rel;
    if (equalsBytes(hStart + ((<usize>(i + 1)) << 1), nStart + 2, tailBytes)) {
      return i;
    }
    i++;
    // Sparse matches benefit from the single-unit scan above. Switch to a
    // two-anchor filter only after several nearby candidates failed.
    if (++failures == 4) {
      if (i - windowStart <= 32 && last - i >= 16) {
        return indexOfWide(hStart, nStart, nLen, i, scanEnd);
      }
      failures = 0;
      windowStart = i;
    }
  }
  return -1;
}

function indexOfWide(
  hStart: usize,
  nStart: usize,
  nLen: i32,
  i: i32,
  scanEnd: usize,
): i32 {
  let p = hStart + ((<usize>i) << 1);
  const tailBytes = (<usize>(nLen - 1)) << 1;
  const first = load<u16>(nStart);
  // Repeated endpoints (e.g. "aba") are weak filters. Prefer the last unit
  // differing from the first, falling back to the adjacent unit if all match.
  let anchor = tailBytes;
  while (anchor > 2 && load<u16>(nStart + anchor) == first) anchor -= 2;
  const second = load<u16>(nStart + anchor);
  if (ASC_FEATURE_SIMD) {
    const firsts = i16x8.splat(<i16>first);
    const seconds = i16x8.splat(<i16>second);
    while (scanEnd - p >= 16) {
      let mask = i16x8.bitmask(i16x8.eq(v128.load(p), firsts));
      // Once candidates become sparse, avoid loading the second anchor.
      if (mask) mask &= i16x8.bitmask(i16x8.eq(v128.load(p + anchor), seconds));
      while (mask) {
        const at = p + ((<usize>ctz(mask)) << 1);
        if (nLen == 2 || equalsBytes(at + 2, nStart + 2, tailBytes)) {
          return <i32>((at - hStart) >> 1);
        }
        mask &= mask - 1;
      }
      p += 16;
    }
  } else {
    const firsts = <u64>first * LANE_ONES;
    const seconds = <u64>second * LANE_ONES;
    while (scanEnd - p >= 8) {
      const diff = load<u64>(p) ^ firsts;
      let mask = (diff - LANE_ONES) & ~diff & LANE_HIGH;
      if (mask) mask = zeroUnitMask(diff | (load<u64>(p + anchor) ^ seconds));
      while (mask) {
        const at = p + ((<usize>(ctz(mask) >> 4)) << 1);
        if (nLen == 2 || equalsBytes(at + 2, nStart + 2, tailBytes)) {
          return <i32>((at - hStart) >> 1);
        }
        mask &= mask - 1;
      }
      p += 8;
    }
  }
  while (p < scanEnd) {
    if (load<u16>(p) == first && equalsBytes(p + 2, nStart + 2, tailBytes)) {
      return <i32>((p - hStart) >> 1);
    }
    p += 2;
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

  let i = min(max(from, 0), hLen - nLen);
  if (i >= 16) return lastIndexOfWide(hStart, nStart, nLen, i);
  if (nLen == 2) {
    const pair = load<u32>(nStart);
    for (; i >= 0; i--) {
      if (load<u32>(hStart + ((<usize>i) << 1)) == pair) return i;
    }
    return -1;
  }
  const first = load<u16>(nStart);
  const tailBytes = (<usize>(nLen - 1)) << 1;
  for (; i >= 0; i--) {
    if (load<u16>(hStart + ((<usize>i) << 1)) != first) continue;
    if (
      nLen == 1 ||
      equalsBytes(hStart + ((<usize>(i + 1)) << 1), nStart + 2, tailBytes)
    )
      return i;
  }
  return -1;
}

// Keep vector setup out of the short-search helper so runtimes can inline it.
function lastIndexOfWide(hStart: usize, nStart: usize, nLen: i32, i: i32): i32 {
  const first = load<u16>(nStart);
  const tailBytes = (<usize>(nLen - 1)) << 1;
  const nEnd = nStart + ((<usize>nLen) << 1);
  let p = hStart + ((<usize>i) << 1);
  if (
    load<u16>(p) == first &&
    (nLen == 1 || equalsBytes(p + 2, nStart + 2, tailBytes))
  )
    return i;
  if (nLen == 1) return findLastUnit(hStart, p, first);

  // Filter both ends of each candidate before comparing its full contents.
  const last = load<u16>(nEnd - 2);
  if (ASC_FEATURE_SIMD) {
    const firsts = i16x8.splat(<i16>first);
    const lasts = i16x8.splat(<i16>last);
    while (p - hStart >= 16) {
      p -= 16;
      let mask = i16x8.bitmask(
        v128.and(
          i16x8.eq(v128.load(p), firsts),
          i16x8.eq(v128.load(p + tailBytes), lasts),
        ),
      );
      while (mask) {
        const lane = 31 - clz(mask);
        const at = p + ((<usize>lane) << 1);
        if (nLen == 2 || equalsBytes(at + 2, nStart + 2, tailBytes)) {
          return <i32>((at - hStart) >> 1);
        }
        mask &= ~(1 << lane);
      }
    }
  } else {
    const firsts = <u64>first * LANE_ONES;
    const lasts = <u64>last * LANE_ONES;
    while (p - hStart >= 8) {
      p -= 8;
      let mask = zeroUnitMask(
        (load<u64>(p) ^ firsts) | (load<u64>(p + tailBytes) ^ lasts),
      );
      while (mask) {
        const lane = 3 - <i32>(clz(mask) >> 4);
        const at = p + ((<usize>lane) << 1);
        if (nLen == 2 || equalsBytes(at + 2, nStart + 2, tailBytes)) {
          return <i32>((at - hStart) >> 1);
        }
        mask &= ~((<u64>0x8000) << (lane << 4));
      }
    }
  }
  while (p > hStart) {
    p -= 2;
    if (load<u16>(p) != first) continue;
    if (equalsBytes(p + 2, nStart + 2, tailBytes)) {
      return <i32>((p - hStart) >> 1);
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

/** Fill a destination by doubling an initialized prefix of a non-empty pattern. */
export function repeatBytes(
  dst: usize,
  src: usize,
  srcBytes: usize,
  totalBytes: usize,
): void {
  if (!srcBytes || !totalBytes) return;
  if (srcBytes == 1) {
    memory.fill(dst, load<u8>(src), totalBytes);
    return;
  }
  let filled: usize;
  if (srcBytes == 2 && totalBytes >= 4) {
    const pattern = <u64>load<u16>(src) * LANE_ONES;
    if (totalBytes >= 8) {
      store<u64>(dst, pattern);
      filled = 8;
    } else {
      store<u32>(dst, <u32>pattern);
      filled = 4;
    }
  } else if (srcBytes == 4 && totalBytes >= 8) {
    const pattern = <u64>load<u32>(src);
    store<u64>(dst, pattern | (pattern << 32));
    filled = 8;
  } else {
    filled = min(srcBytes, totalBytes);
    copyBytes(dst, src, filled);
  }
  while (filled < totalBytes) {
    const chunk = min(filled, totalBytes - filled);
    copyBytes(dst + filled, dst, chunk);
    filled += chunk;
  }
}

/** Validate in 64 bits before narrowing a computed allocation size to wasm32. */
// @ts-ignore: decorator
@inline export function checkedSize(bytes: u64): usize {
  if (bytes > <u64>OBJECT_MAXSIZE) throw new RangeError("Invalid length");
  return <usize>bytes;
}

/** Allocate an uninitialized `string` of `bytes` bytes (2 per code unit). */
// @ts-ignore: decorator
@inline export function allocString(bytes: u64): string {
  return changetype<string>(__new(checkedSize(bytes), idof<string>()));
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

// Count a vector's bytes and carry its final high-surrogate bit. Every
// surrogate starts at three bytes; each adjacent high/low pair subtracts two.
// This is also exact for WTF-8: lone surrogates retain their three-byte count.
// @ts-ignore: decorator
@inline function utf8VectorSize(word: v128, previousHigh: u32): u64 {
  let size =
    8 +
    popcnt(i16x8.bitmask(i16x8.ge_u(word, i16x8.splat(0x80)))) +
    popcnt(i16x8.bitmask(i16x8.ge_u(word, i16x8.splat(0x800))));
  const tags = v128.and(word, i16x8.splat(<i16>0xf800));
  let lastHigh: u32 = 0;
  if (v128.any_true(i16x8.eq(tags, i16x8.splat(<i16>0xd800)))) {
    const kinds = v128.and(word, i16x8.splat(<i16>0xfc00));
    const highs = i16x8.bitmask(i16x8.eq(kinds, i16x8.splat(<i16>0xd800)));
    const lows = i16x8.bitmask(i16x8.eq(kinds, i16x8.splat(<i16>0xdc00)));
    size -= (popcnt(highs & (lows >> 1)) + <i32>(previousHigh & lows & 1)) << 1;
    lastHigh = (<u32>highs) >> 7;
  }
  return (<u64>(<u32>size)) | ((<u64>lastHigh) << 32);
}

/** Exact UTF-8/WTF-8 byte length, including malformed UTF-16 input. */
export function utf8ByteLength(
  start: usize,
  length: i32,
  nullTerminated: bool = false,
): i32 {
  if (!ASC_FEATURE_SIMD || nullTerminated)
    return U8.byteLengthUnsafe(start, length, nullTerminated);
  const end = start + ((<usize>length) << 1);
  let p = start;
  let size = 0;
  let previousHigh: u32 = 0;
  while (end - p >= 64) {
    const a = v128.load(p);
    const b = v128.load(p + 16);
    const c = v128.load(p + 32);
    const d = v128.load(p + 48);
    const any = v128.or(v128.or(a, b), v128.or(c, d));
    if (!v128.any_true(v128.and(any, i16x8.splat(<i16>0xff80)))) {
      size += 32;
      previousHigh = 0;
    } else {
      let packed = utf8VectorSize(a, previousHigh);
      size += <i32>packed;
      previousHigh = <u32>(packed >> 32);
      packed = utf8VectorSize(b, previousHigh);
      size += <i32>packed;
      previousHigh = <u32>(packed >> 32);
      packed = utf8VectorSize(c, previousHigh);
      size += <i32>packed;
      previousHigh = <u32>(packed >> 32);
      packed = utf8VectorSize(d, previousHigh);
      size += <i32>packed;
      previousHigh = <u32>(packed >> 32);
    }
    p += 64;
  }
  while (end - p >= 16) {
    const packed = utf8VectorSize(v128.load(p), previousHigh);
    size += <i32>packed;
    previousHigh = <u32>(packed >> 32);
    p += 16;
  }
  while (p < end) {
    const c = load<u16>(p);
    size += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    if (previousHigh && (c & 0xfc00) == 0xdc00) size -= 2;
    previousHigh = <u32>((c & 0xfc00) == 0xd800);
    p += 2;
  }
  return size;
}

/** Allocate an exactly sized UTF-8 buffer before invoking the raw encoder. */
export function encodeUtf8Range(
  start: usize,
  length: i32,
  nullTerminated: bool = false,
  errorMode: U8.ErrorMode = U8.ErrorMode.WTF8,
): ArrayBuffer {
  const size = utf8ByteLength(start, length, nullTerminated);
  const buffer = changetype<ArrayBuffer>(
    __new(checkedSize(<u64>size), idof<ArrayBuffer>()),
  );
  U8.encodeUnsafe(
    start,
    length,
    changetype<usize>(buffer),
    nullTerminated,
    errorMode,
  );
  return buffer;
}

export function encodeUtf8(text: string): ArrayBuffer {
  return encodeUtf8Range(changetype<usize>(text), text.length);
}
