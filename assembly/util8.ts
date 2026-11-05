// Low-level UTF-8 byte helpers for `str8`. Scans use SIMD, SWAR, then scalar tails.
import {
  checkedSize,
  copyBytes,
  equalsBytes,
  twoWayIndexOf,
  twoWayLastIndexOf,
} from "./util";

// Per-byte-lane constants for the SWAR zero/diff detection (Mycroft's trick).
const LANE_ONES_8: u64 = 0x0101010101010101;
const LANE_HIGH_8: u64 = 0x8080808080808080;

// Lazy so no-SIMD builds never emit these splat initializers.
// @ts-ignore: decorator
@lazy const CONT_HIGH2: v128 = i8x16.splat(<i8>0xc0); // isolates the top 2 bits
// @ts-ignore: decorator
@lazy const CONT_TAG: v128 = i8x16.splat(<i8>0x80); // continuation marker 0b10......

/** Number of bytes a UTF-8 sequence with the given lead byte occupies (1-4). */
// A continuation/invalid lead byte yields 1 so callers always advance.
// @ts-ignore: decorator
@inline export function utf8SeqLen(lead: u8): i32 {
  if (lead < 0x80) return 1;
  if ((lead & 0xe0) == 0xc0) return 2;
  if ((lead & 0xf0) == 0xe0) return 3;
  if ((lead & 0xf8) == 0xf0) return 4;
  return 1;
}

/** Whether byte offset `i` lands on a UTF-8 codepoint boundary. */
// @ts-ignore: decorator
@inline export function isCharBoundary(
  start: usize,
  end: usize,
  i: usize,
): bool {
  if (i == 0) return true;
  const p = start + i;
  if (p > end) return false;
  if (p == end) return true;
  return (load<u8>(p) & 0xc0) != 0x80;
}

/** Decode at `p`, packed as `(codepoint << 32) | byteWidth`. */
export function decodeCodePointAt(p: usize, end: usize): u64 {
  const b0 = <u32>load<u8>(p);
  if (b0 < 0x80) return ((<u64>b0) << 32) | 1;
  if ((b0 & 0xe0) == 0xc0) {
    if (p + 2 > end) return ((<u64>0xfffd) << 32) | 1;
    const b1 = <u32>load<u8>(p + 1);
    const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
    return ((<u64>cp) << 32) | 2;
  }
  if ((b0 & 0xf0) == 0xe0) {
    if (p + 3 > end) return ((<u64>0xfffd) << 32) | 1;
    const b1 = <u32>load<u8>(p + 1);
    const b2 = <u32>load<u8>(p + 2);
    const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
    return ((<u64>cp) << 32) | 3;
  }
  if ((b0 & 0xf8) == 0xf0) {
    if (p + 4 > end) return ((<u64>0xfffd) << 32) | 1;
    const b1 = <u32>load<u8>(p + 1);
    const b2 = <u32>load<u8>(p + 2);
    const b3 = <u32>load<u8>(p + 3);
    const cp =
      ((b0 & 0x07) << 18) |
      ((b1 & 0x3f) << 12) |
      ((b2 & 0x3f) << 6) |
      (b3 & 0x3f);
    return ((<u64>cp) << 32) | 4;
  }
  return ((<u64>0xfffd) << 32) | 1;
}

/** Unpack the codepoint from a `decodeCodePointAt` result. */
// @ts-ignore: decorator
@inline export function cpOf(packed: u64): i32 {
  return <i32>(packed >>> 32);
}
/** Unpack the byte width from a `decodeCodePointAt` result. */
// @ts-ignore: decorator
@inline export function widthOf(packed: u64): i32 {
  return <i32>(packed & 0xffffffff);
}

/** Start pointer of the codepoint before `p`. */
export function prevCodePointStart(start: usize, p: usize): usize {
  let q = p - 1;
  while (q > start && (load<u8>(q) & 0xc0) == 0x80) q--;
  return q;
}

/** Number of Unicode codepoints in `[start, end)`. */
export function codePointCount(start: usize, end: usize): i32 {
  const total = <i32>(end - start);
  let cont = 0;
  let p = start;
  if (ASC_FEATURE_SIMD) {
    while (p + 16 <= end) {
      const isCont = i8x16.eq(v128.and(v128.load(p), CONT_HIGH2), CONT_TAG);
      cont += <i32>popcnt(i8x16.bitmask(isCont));
      p += 16;
    }
  } else {
    while (p + 8 <= end) {
      const w = load<u64>(p);
      // A continuation byte has bit7 set and bit6 clear.
      const b7 = (w >> 7) & LANE_ONES_8;
      const b6 = (w >> 6) & LANE_ONES_8;
      cont += <i32>popcnt(b7 & (b6 ^ LANE_ONES_8));
      p += 8;
    }
  }
  while (p < end) {
    if ((load<u8>(p) & 0xc0) == 0x80) cont++;
    p++;
  }
  return total - cont;
}

/** Whether every byte in `[start, end)` is ASCII. */
export function isAsciiRange(start: usize, end: usize): bool {
  let p = start;
  if (ASC_FEATURE_SIMD) {
    while (p + 16 <= end) {
      if (i8x16.bitmask(v128.load(p))) return false;
      p += 16;
    }
  } else {
    while (p + 8 <= end) {
      if (load<u64>(p) & LANE_HIGH_8) return false;
      p += 8;
    }
  }
  while (p < end) {
    if (load<u8>(p) & 0x80) return false;
    p++;
  }
  return true;
}

/** Copy ASCII bytes while folding `[lo, hi]` by `delta`. */
export function asciiCaseFold(
  dst: usize,
  src: usize,
  n: usize,
  lo: u8,
  hi: u8,
  delta: i32,
): void {
  let i: usize = 0;
  if (ASC_FEATURE_SIMD) {
    const vlo = i8x16.splat(<i8>lo);
    const vhi = i8x16.splat(<i8>hi);
    const vd = i8x16.splat(<i8>delta);
    for (; i + 16 <= n; i += 16) {
      const va = v128.load(src + i);
      const inRange = v128.and(i8x16.ge_s(va, vlo), i8x16.le_s(va, vhi));
      v128.store(dst + i, i8x16.add(va, v128.and(inRange, vd)));
    }
  }
  // SWAR per-byte range test; input is ASCII, so lanes do not overflow.
  const bGe = <u64>(0x80 - lo) * LANE_ONES_8;
  const bLt = <u64>(0x80 - (<i32>hi + 1)) * LANE_ONES_8;
  const sub = delta < 0;
  for (; i + 8 <= n; i += 8) {
    const w = load<u64>(src + i);
    const fold = ((w + bGe) & ~(w + bLt) & LANE_HIGH_8) >> 2;
    store<u64>(dst + i, sub ? w - fold : w + fold);
  }
  for (; i < n; i++) {
    const c = load<u8>(src + i);
    store<u8>(dst + i, <u8>(c >= lo && c <= hi ? <i32>c + delta : <i32>c));
  }
}

/** Find `needle` in `[start, end)`, returning its byte offset or `-1`. */
export function findByte(start: usize, end: usize, needle: u8): i32 {
  let p = start;
  if (ASC_FEATURE_SIMD) {
    if (p + 16 <= end) {
      const splat = i8x16.splat(<i8>needle);
      let mask = 0;
      do {
        mask = i8x16.bitmask(i8x16.eq(v128.load(p), splat));
        if (mask) break;
        p += 16;
      } while (p + 16 <= end);
      // Calculate the position only after the scan has found a matching block.
      if (mask) return <i32>(p - start) + ctz(mask);
    }
  } else {
    if (p + 8 <= end) {
      const bcast = <u64>needle * LANE_ONES_8;
      let mask: u64 = 0;
      do {
        const x = load<u64>(p) ^ bcast;
        mask = (x - LANE_ONES_8) & ~x & LANE_HIGH_8;
        if (mask) break;
        p += 8;
      } while (p + 8 <= end);
      if (mask) return <i32>(p - start) + <i32>(ctz(mask) >> 3);
    }
  }
  while (p < end) {
    if (load<u8>(p) == needle) return <i32>(p - start);
    p++;
  }
  return -1;
}

/** Find the last matching byte without reading outside `[start, end)`. */
export function findLastByte(start: usize, end: usize, needle: u8): i32 {
  let p = end;
  if (ASC_FEATURE_SIMD) {
    const splat = i8x16.splat(<i8>needle);
    while (p - start >= 16) {
      p -= 16;
      const mask = i8x16.bitmask(i8x16.eq(v128.load(p), splat));
      if (mask) return <i32>(p - start) + 31 - clz(mask);
    }
  } else {
    const bcast = <u64>needle * LANE_ONES_8;
    while (p - start >= 8) {
      p -= 8;
      const mask = zeroByteMask(load<u64>(p) ^ bcast);
      if (mask) return <i32>(p - start) + 7 - <i32>(clz(mask) >> 3);
    }
  }
  while (p > start) {
    p--;
    if (load<u8>(p) == needle) return <i32>(p - start);
  }
  return -1;
}

// Exact zero lanes are required when selecting the last match: subtraction
// masks used by forward scans can also mark adjacent nonzero higher lanes.
// @ts-ignore: decorator
@inline function zeroByteMask(x: u64): u64 {
  const low = ~LANE_HIGH_8;
  return ~(((x & low) + low) | x | low);
}

/** Find the first needle byte range in the haystack. */
export function indexOfBytes(
  hStart: usize,
  hEnd: usize,
  nStart: usize,
  nEnd: usize,
  from: i32,
): i32 {
  const hLen = <i32>(hEnd - hStart);
  const nLen = <i32>(nEnd - nStart);
  // Empty needles match at 0.
  if (nLen == 0) return 0;
  if (nLen > hLen) return -1;

  const first = load<u8>(nStart);
  const last = hLen - nLen;
  const scanEnd = hStart + <usize>(last + 1);
  const tailBytes = <usize>(nLen - 1);
  let i = max(from, 0);
  if (i > last) return -1;
  if (nLen == 2 && last - i < 16) {
    const pair = load<u16>(nStart);
    for (; i <= last; i++) {
      if (load<u16>(hStart + <usize>i) == pair) return i;
    }
    return -1;
  }
  const rel = findByte(hStart + <usize>i, scanEnd, first);
  if (rel < 0) return -1;
  i += rel;
  if (
    nLen == 1 ||
    equalsBytes(hStart + <usize>(i + 1), nStart + 1, tailBytes)
  ) {
    return i;
  }
  return indexOfBytesRemainder(hStart, nStart, nLen, i + 1, last);
}

// Keep failed-candidate bookkeeping out of the common first-match path.
function indexOfBytesRemainder(
  hStart: usize,
  nStart: usize,
  nLen: i32,
  i: i32,
  last: i32,
): i32 {
  const first = load<u8>(nStart);
  const scanEnd = hStart + <usize>(last + 1);
  const tailBytes = <usize>(nLen - 1);
  if (last - i < 16) {
    for (; i <= last; i++) {
      const p = hStart + <usize>i;
      if (load<u8>(p) == first && equalsBytes(p + 1, nStart + 1, tailBytes)) {
        return i;
      }
    }
    return -1;
  }
  let windowStart = i - 1;
  let failures = 1;

  while (i <= last) {
    const rel = findByte(hStart + <usize>i, scanEnd, first);
    if (rel < 0) return -1;
    i += rel;
    if (equalsBytes(hStart + <usize>(i + 1), nStart + 1, tailBytes)) {
      return i;
    }
    i++;
    // Keep the cheaper single-byte scan for sparse matches. Dense failed
    // candidates benefit from filtering both ends of the needle at once.
    if (++failures == 4) {
      if (nLen >= 256)
        return twoWayIndexOf<u8>(
          hStart,
          <i32>(scanEnd - hStart) + nLen - 1,
          nStart,
          nLen,
          i,
        );
      if (i - windowStart <= 32 && last - i >= 16) {
        return indexOfBytesWide(hStart, nStart, nLen, i, scanEnd);
      }
      failures = 0;
      windowStart = i;
    }
  }
  return -1;
}

function indexOfBytesWide(
  hStart: usize,
  nStart: usize,
  nLen: i32,
  i: i32,
  scanEnd: usize,
): i32 {
  let p = hStart + <usize>i;
  const tailBytes = <usize>(nLen - 1);
  const first = load<u8>(nStart);
  // Prefer a distinct byte when the needle repeats its first byte at the end.
  let anchor = tailBytes;
  while (anchor > 1 && load<u8>(nStart + anchor) == first) anchor--;
  const second = load<u8>(nStart + anchor);
  if (ASC_FEATURE_SIMD) {
    const firsts = i8x16.splat(<i8>first);
    const seconds = i8x16.splat(<i8>second);
    while (scanEnd - p >= 16) {
      let mask = i8x16.bitmask(i8x16.eq(v128.load(p), firsts));
      if (mask) mask &= i8x16.bitmask(i8x16.eq(v128.load(p + anchor), seconds));
      while (mask) {
        const at = p + <usize>ctz(mask);
        if (nLen == 2 || equalsBytes(at + 1, nStart + 1, tailBytes)) {
          return <i32>(at - hStart);
        }
        mask &= mask - 1;
      }
      p += 16;
    }
  } else {
    const firsts = <u64>first * LANE_ONES_8;
    const seconds = <u64>second * LANE_ONES_8;
    while (scanEnd - p >= 8) {
      const diff = load<u64>(p) ^ firsts;
      let mask = (diff - LANE_ONES_8) & ~diff & LANE_HIGH_8;
      if (mask) mask = zeroByteMask(diff | (load<u64>(p + anchor) ^ seconds));
      while (mask) {
        const at = p + <usize>(ctz(mask) >> 3);
        if (nLen == 2 || equalsBytes(at + 1, nStart + 1, tailBytes)) {
          return <i32>(at - hStart);
        }
        mask &= mask - 1;
      }
      p += 8;
    }
  }
  while (p < scanEnd) {
    if (load<u8>(p) == first && equalsBytes(p + 1, nStart + 1, tailBytes)) {
      return <i32>(p - hStart);
    }
    p++;
  }
  return -1;
}

/** Find the last needle byte range at or before `from`. */
export function lastIndexOfBytes(
  hStart: usize,
  hEnd: usize,
  nStart: usize,
  nEnd: usize,
  from: i32,
): i32 {
  const hLen = <i32>(hEnd - hStart);
  const nLen = <i32>(nEnd - nStart);
  // Empty needles match at the end.
  if (nLen == 0) return hLen;
  if (nLen > hLen) return -1;

  let i = min(max(from, 0), hLen - nLen);
  if (i >= 16) return lastIndexOfBytesWide(hStart, nStart, nLen, i);
  if (nLen == 2) {
    const pair = load<u16>(nStart);
    for (; i >= 0; i--) {
      if (load<u16>(hStart + <usize>i) == pair) return i;
    }
    return -1;
  }
  const first = load<u8>(nStart);
  const tailBytes = <usize>(nLen - 1);
  for (; i >= 0; i--) {
    if (load<u8>(hStart + <usize>i) != first) continue;
    if (
      nLen == 1 ||
      equalsBytes(hStart + <usize>(i + 1), nStart + 1, tailBytes)
    )
      return i;
  }
  return -1;
}

// Keep vector setup out of the short-search helper so runtimes can inline it.
function lastIndexOfBytesWide(
  hStart: usize,
  nStart: usize,
  nLen: i32,
  i: i32,
): i32 {
  let verifications = 0;
  const first = load<u8>(nStart);
  const tailBytes = <usize>(nLen - 1);
  const nEnd = nStart + <usize>nLen;
  let p = hStart + <usize>i;
  if (
    load<u8>(p) == first &&
    (nLen == 1 || equalsBytes(p + 1, nStart + 1, tailBytes))
  )
    return i;
  if (nLen == 1) return findLastByte(hStart, p, first);

  const last = load<u8>(nEnd - 1);
  if (ASC_FEATURE_SIMD) {
    const firsts = i8x16.splat(<i8>first);
    const lasts = i8x16.splat(<i8>last);
    while (p - hStart >= 16) {
      p -= 16;
      let mask = i8x16.bitmask(
        v128.and(
          i8x16.eq(v128.load(p), firsts),
          i8x16.eq(v128.load(p + tailBytes), lasts),
        ),
      );
      while (mask) {
        const lane = 31 - clz(mask);
        const at = p + <usize>lane;
        if (nLen == 2 || equalsBytes(at + 1, nStart + 1, tailBytes)) {
          return <i32>(at - hStart);
        }
        if (nLen >= 256 && ++verifications == 8)
          return twoWayLastIndexOf<u8>(
            hStart,
            nStart,
            nLen,
            <i32>(at - hStart) - 1,
          );
        mask &= ~(1 << lane);
      }
    }
  } else {
    const firsts = <u64>first * LANE_ONES_8;
    const lasts = <u64>last * LANE_ONES_8;
    while (p - hStart >= 8) {
      p -= 8;
      let mask = zeroByteMask(
        (load<u64>(p) ^ firsts) | (load<u64>(p + tailBytes) ^ lasts),
      );
      while (mask) {
        const lane = 7 - <i32>(clz(mask) >> 3);
        const at = p + <usize>lane;
        if (nLen == 2 || equalsBytes(at + 1, nStart + 1, tailBytes)) {
          return <i32>(at - hStart);
        }
        if (nLen >= 256 && ++verifications == 8)
          return twoWayLastIndexOf<u8>(
            hStart,
            nStart,
            nLen,
            <i32>(at - hStart) - 1,
          );
        mask &= ~((<u64>0x80) << (lane << 3));
      }
    }
  }
  while (p > hStart) {
    p--;
    if (load<u8>(p) == first && equalsBytes(p + 1, nStart + 1, tailBytes)) {
      return <i32>(p - hStart);
    }
  }
  return -1;
}

/** Lexicographic unsigned-byte compare of two ranges. */
export function compareBytes(
  aStart: usize,
  aEnd: usize,
  bStart: usize,
  bEnd: usize,
): i32 {
  const aLen = <i32>(aEnd - aStart);
  const bLen = <i32>(bEnd - bStart);
  let rem = aLen < bLen ? aLen : bLen;
  let pa = aStart;
  let pb = bStart;

  if (ASC_FEATURE_SIMD) {
    while (rem >= 16) {
      const mask = i8x16.bitmask(i8x16.eq(v128.load(pa), v128.load(pb)));
      if (mask != 0xffff) {
        const lane = <usize>ctz(~mask & 0xffff);
        const ca = load<u8>(pa + lane);
        const cb = load<u8>(pb + lane);
        return ca < cb ? -1 : 1;
      }
      pa += 16;
      pb += 16;
      rem -= 16;
    }
  } else {
    while (rem >= 8) {
      const wa = load<u64>(pa);
      const wb = load<u64>(pb);
      if (wa != wb) {
        const lane = <usize>(ctz(wa ^ wb) >> 3);
        const ca = load<u8>(pa + lane);
        const cb = load<u8>(pb + lane);
        return ca < cb ? -1 : 1;
      }
      pa += 8;
      pb += 8;
      rem -= 8;
    }
  }

  while (rem > 0) {
    const ca = load<u8>(pa);
    const cb = load<u8>(pb);
    if (ca != cb) return ca < cb ? -1 : 1;
    pa++;
    pb++;
    rem--;
  }
  return aLen == bLen ? 0 : aLen < bLen ? -1 : 1;
}

/** Allocate an uninitialized `ArrayBuffer` of `bytes` bytes. */
// @ts-ignore: decorator
@inline export function allocBuffer(bytes: u64): ArrayBuffer {
  // @ts-expect-error: exists
  return changetype<ArrayBuffer>(
    __new(checkedSize(bytes), idof<ArrayBuffer>()),
  );
}

/** Allocate a fresh `ArrayBuffer` and copy `[start, end)` bytes into it. */
export function materializeBuffer(start: usize, end: usize): ArrayBuffer {
  const bytes = end - start;
  const out = allocBuffer(bytes);
  if (bytes) copyBytes(changetype<usize>(out), start, bytes);
  return out;
}
