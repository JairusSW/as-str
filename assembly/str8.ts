import {
  copyBytes,
  equals as rangeEquals,
  equalsBytes,
  isWhiteSpace,
} from "./util";
import {
  allocBuffer,
  asciiCaseFold,
  codePointCount as rangeCodePointCount,
  compareBytes,
  cpOf,
  decodeCodePointAt,
  indexOfBytes,
  isAsciiRange,
  isCharBoundary as rangeIsCharBoundary,
  lastIndexOfBytes,
  materializeBuffer,
  prevCodePointStart,
  utf8SeqLen,
  widthOf,
} from "./util8";
import { UTF8 as U8, UTF16 as U16 } from "utf-as";
import { Str } from "./str";

/**
 * A virtual (zero-copy) UTF-8 string: a lightweight view into a UTF-8
 * `ArrayBuffer`.
 *
 * A `Str8` holds a backing `ArrayBuffer` (the GC owner of the bytes) plus a
 * `[start, end)` pair of raw byte pointers describing the slice of that buffer
 * it represents. Unlike {@link str} (which mirrors UTF-16 `String` and indexes
 * by code unit), `Str8` is **byte-indexed**, following Rust `&str` / Go
 * `string`: `length` is the byte length, `slice`/`indexOf`/etc. take and return
 * byte offsets, and codepoint access is provided by helpers
 * (`codePointAt`, `codePointCount`, `byteAt`) layered on top. Because UTF-8 is
 * self-synchronizing and its byte order equals codepoint order, `indexOf`,
 * `includes`, `startsWith`, `endsWith`, `equals` and `compareTo` are all correct
 * operating purely on bytes.
 *
 * Inputs may be a native `string` (transcoded to a UTF-8 buffer on construction
 * - this allocates) or an existing UTF-8 `ArrayBuffer` (wrapped zero-copy). A
 * `Str8` never retains a UTF-16 `string`.
 *
 * View-producing operations (`slice`, `substring`, `charAt`, `trim`, `split`,
 * the `[]`/`+` operators, …) move pointers and copy nothing; allocating
 * operations (`concat`, `repeat`, `padStart`, `replace`, `toUpperCase`, …) build
 * a fresh UTF-8 buffer and return a `Str8` over it; `toString` decodes to a
 * native `string`. Query operations allocate nothing.
 */
// @ts-ignore: decorator
@final export class Str8 {
  /**
   * Construct a view directly from a backing buffer and raw byte pointers.
   *
   * @param buffer - backing UTF-8 buffer; the GC owner of the underlying bytes.
   * @param start  - byte pointer to the first byte of the view.
   * @param end    - byte pointer one past the last byte (exclusive).
   */
  constructor(
    public buffer: ArrayBuffer,
    public start: usize,
    public end: usize,
  ) {}

  /** Maximum length of a backing string, mirroring `String.MAX_LENGTH`. */
  // @ts-expect-error: exists
  static readonly MAX_LENGTH: i32 = String.MAX_LENGTH;

  /**
   * Transcode a native `string` to a fresh UTF-8 buffer and view all of it.
   *
   * @param s - source string.
   * @returns A view over the freshly encoded UTF-8 buffer (allocates).
   */
  static from(s: string): Str8 {
    const buf = U8.encode(s);
    const ptr = changetype<usize>(buf);
    return new Str8(buf, ptr, ptr + <usize>buf.byteLength);
  }

  /**
   * Wrap an existing UTF-8 `ArrayBuffer` as a zero-copy view over all its bytes.
   * The bytes are trusted to be valid UTF-8; use {@link Str8.fromBufferChecked}
   * for untrusted input.
   *
   * @param buf - backing UTF-8 buffer to view.
   * @returns A view covering all of `buf` (no copy).
   */
  static fromBuffer(buf: ArrayBuffer): Str8 {
    const ptr = changetype<usize>(buf);
    return new Str8(buf, ptr, ptr + <usize>buf.byteLength);
  }

  /**
   * Like {@link Str8.fromBuffer} but validates that `buf` holds well-formed
   * UTF-8 first, aborting otherwise.
   *
   * @param buf - backing UTF-8 buffer to validate and view.
   * @returns A view covering all of `buf` (no copy).
   */
  static fromBufferChecked(buf: ArrayBuffer): Str8 {
    assert(U8.validate(buf), "Str8.fromBufferChecked: invalid UTF-8");
    return Str8.fromBuffer(buf);
  }

  /**
   * Build a view over a backing buffer from a `[startByte, endByte)` byte range.
   *
   * @param buf       - backing UTF-8 buffer to view.
   * @param startByte - inclusive start byte offset.
   * @param endByte   - exclusive end byte offset.
   * @returns A view of `buf` covering `[startByte, endByte)` (no copy).
   */
  static fromRange(buf: ArrayBuffer, startByte: usize, endByte: usize): Str8 {
    const base = changetype<usize>(buf);
    return new Str8(buf, base + startByte, base + endByte);
  }

  /**
   * Build a UTF-8 view of a single Unicode code point.
   *
   * @param code - Unicode code point.
   * @returns A view over a freshly allocated buffer.
   */
  static fromCodePoint(code: i32): Str8 {
    return Str8.from(String.fromCodePoint(code));
  }

  /**
   * Build a UTF-8 view of one or two UTF-16 char codes.
   *
   * @param unit - UTF-16 code unit (the high surrogate when `surr` is given).
   * @param surr - optional low surrogate code unit, or -1 for none.
   * @returns A view over a freshly allocated buffer.
   */
  static fromCharCode(unit: i32, surr: i32 = -1): Str8 {
    return Str8.from(String.fromCharCode(unit, surr));
  }

  /** Length of the view in bytes (Rust `.len()` / Go `len()`). */
  get length(): i32 {
    return <i32>(this.end - this.start);
  }

  /** Length of the view in bytes; explicit alias of {@link Str8#length}. */
  get byteLength(): i32 {
    return <i32>(this.end - this.start);
  }

  /** Whether the view is empty (zero bytes). */
  get isEmpty(): bool {
    return this.end == this.start;
  }

  /** Number of Unicode codepoints in the view (O(n); Go `utf8.RuneCountInString`). */
  codePointCount(): i32 {
    return rangeCodePointCount(this.start, this.end);
  }

  /**
   * Shared range implementation for `slice`. Negative bounds count from the end
   * and out-of-range bounds clamp into `[0, len]`.
   * @internal
   */
  static sliceRange(
    buffer: ArrayBuffer,
    start: usize,
    end: usize,
    lo0: i32,
    hi0: i32,
  ): Str8 {
    const len = <i32>(end - start);
    let lo = lo0 < 0 ? max(len + lo0, 0) : min(lo0, len);
    let hi = hi0 < 0 ? max(len + hi0, 0) : min(hi0, len);
    if (hi < lo) hi = lo;
    return new Str8(buffer, start + <usize>lo, start + <usize>hi);
  }

  /**
   * Shared range implementation for `substring`. Negative bounds clamp to 0 and
   * the bounds swap when `lo0 > hi0`.
   * @internal
   */
  static substringRange(
    buffer: ArrayBuffer,
    start: usize,
    end: usize,
    lo0: i32,
    hi0: i32,
  ): Str8 {
    const len = <i32>(end - start);
    let lo = lo0 < 0 ? 0 : min(lo0, len);
    let hi = hi0 < 0 ? 0 : min(hi0, len);
    if (lo > hi) {
      const t = lo;
      lo = hi;
      hi = t;
    }
    return new Str8(buffer, start + <usize>lo, start + <usize>hi);
  }

  /**
   * Shared range implementation for `substr`. A negative `start0` counts from
   * the end and a negative `length` yields an empty view.
   * @internal
   */
  static substrRange(
    buffer: ArrayBuffer,
    start: usize,
    end: usize,
    start0: i32,
    length: i32,
  ): Str8 {
    const len = <i32>(end - start);
    let lo = start0 < 0 ? max(len + start0, 0) : min(start0, len);
    let count = length < 0 ? 0 : min(length, len - lo);
    return new Str8(buffer, start + <usize>lo, start + <usize>(lo + count));
  }

  /**
   * Shared range implementation for `charAt`: a single-codepoint view starting
   * at byte `index`, or an empty view if out of range.
   * @internal
   */
  static charAtRange(
    buffer: ArrayBuffer,
    start: usize,
    end: usize,
    index: i32,
  ): Str8 {
    if (<u32>index >= <u32>(end - start)) return new Str8(buffer, start, start);
    const at = start + <usize>index;
    let e = at + <usize>utf8SeqLen(load<u8>(at));
    if (e > end) e = end;
    return new Str8(buffer, at, e);
  }

  /**
   * Shared range implementation for `at`; supports negative byte indices.
   * @internal
   */
  static atRange(
    buffer: ArrayBuffer,
    start: usize,
    end: usize,
    index: i32,
  ): Str8 {
    const len = <i32>(end - start);
    if (index < 0) index += len;
    if (<u32>index >= <u32>len) return new Str8(buffer, start, start);
    const at = start + <usize>index;
    let e = at + <usize>utf8SeqLen(load<u8>(at));
    if (e > end) e = end;
    return new Str8(buffer, at, e);
  }

  /**
   * Shared range implementation for `trimStart`; skips leading whitespace
   * codepoints.
   * @internal
   */
  static trimStartRange(buffer: ArrayBuffer, start: usize, end: usize): Str8 {
    let p = start;
    while (p < end) {
      const packed = decodeCodePointAt(p, end);
      const cp = cpOf(packed);
      if (cp >= 0x10000 || !isWhiteSpace(<u16>cp)) break;
      p += <usize>widthOf(packed);
    }
    return new Str8(buffer, p, end);
  }

  /**
   * Shared range implementation for `trimEnd`; skips trailing whitespace
   * codepoints.
   * @internal
   */
  static trimEndRange(buffer: ArrayBuffer, start: usize, end: usize): Str8 {
    let p = end;
    while (p > start) {
      const q = prevCodePointStart(start, p);
      const cp = cpOf(decodeCodePointAt(q, end));
      if (cp >= 0x10000 || !isWhiteSpace(<u16>cp)) break;
      p = q;
    }
    return new Str8(buffer, start, p);
  }

  /**
   * Shared range implementation for `trim`; skips leading and trailing
   * whitespace codepoints.
   * @internal
   */
  static trimRange(buffer: ArrayBuffer, start: usize, end: usize): Str8 {
    let lo = start;
    while (lo < end) {
      const packed = decodeCodePointAt(lo, end);
      const cp = cpOf(packed);
      if (cp >= 0x10000 || !isWhiteSpace(<u16>cp)) break;
      lo += <usize>widthOf(packed);
    }
    let hi = end;
    while (hi > lo) {
      const q = prevCodePointStart(lo, hi);
      const cp = cpOf(decodeCodePointAt(q, end));
      if (cp >= 0x10000 || !isWhiteSpace(<u16>cp)) break;
      hi = q;
    }
    return new Str8(buffer, lo, hi);
  }

  /**
   * Shared range implementation for `codePointAt`.
   * @internal
   */
  static codePointAtRange(start: usize, end: usize, index: i32): i32 {
    if (<u32>index >= <u32>(end - start)) return -1;
    return cpOf(decodeCodePointAt(start + <usize>index, end));
  }

  /**
   * Shared range implementation for `byteAt`.
   * @internal
   */
  static byteAtRange(start: usize, end: usize, index: i32): i32 {
    if (<u32>index >= <u32>(end - start)) return -1;
    return <i32>load<u8>(start + <usize>index);
  }

  /**
   * Shared range implementation for `startsWith`; compares the needle's bytes at
   * a clamped byte offset.
   * @internal
   */
  static startsWithRange(
    start: usize,
    end: usize,
    nStart: usize,
    nEnd: usize,
    at0: i32,
  ): bool {
    const nBytes = <i32>(nEnd - nStart);
    const len = <i32>(end - start);
    const at = at0 < 0 ? 0 : at0 > len ? len : at0;
    if (at + nBytes > len) return false;
    return equalsBytes(start + <usize>at, nStart, <usize>nBytes);
  }

  /**
   * Shared range implementation for `endsWith`; compares the needle's bytes
   * ending at a clamped byte offset.
   * @internal
   */
  static endsWithRange(
    start: usize,
    end: usize,
    nStart: usize,
    nEnd: usize,
    end0: i32,
  ): bool {
    const nBytes = <i32>(nEnd - nStart);
    const len = <i32>(end - start);
    const hi = end0 < 0 ? 0 : end0 > len ? len : end0;
    const lo = hi - nBytes;
    if (lo < 0) return false;
    return equalsBytes(start + <usize>lo, nStart, <usize>nBytes);
  }

  /**
   * Return a section of the view. Negative byte indices count from the end.
   *
   * @param start - start byte index (negative counts from the end).
   * @param end   - end byte index, exclusive; defaults to the view's end.
   * @returns A view of the slice (no copy). May cut mid-codepoint (Go-style);
   *          use {@link Str8#isCharBoundary} to guard.
   */
  slice(start: i32 = 0, end: i32 = i32.MAX_VALUE): Str8 {
    return Str8.sliceRange(this.buffer, this.start, this.end, start, end);
  }

  /**
   * Return the substring between two byte indices. Negative indices clamp to 0,
   * and the arguments swap when `start > end`.
   */
  substring(start: i32 = 0, end: i32 = i32.MAX_VALUE): Str8 {
    return Str8.substringRange(this.buffer, this.start, this.end, start, end);
  }

  /**
   * Return a substring beginning at byte `start` with the given byte length. A
   * negative `start` counts from the end.
   */
  substr(start: i32 = 0, length: i32 = i32.MAX_VALUE): Str8 {
    return Str8.substrRange(this.buffer, this.start, this.end, start, length);
  }

  /**
   * Return the codepoint starting at byte `index` as a single-codepoint view.
   *
   * @param index - byte index of a codepoint's lead byte.
   * @returns A single-codepoint view, or an empty view if out of range.
   */
  charAt(index: i32): Str8 {
    return Str8.charAtRange(this.buffer, this.start, this.end, index);
  }

  /**
   * Like {@link Str8#charAt} but supports negative byte indices.
   */
  at(index: i32): Str8 {
    return Str8.atRange(this.buffer, this.start, this.end, index);
  }

  /** Remove leading whitespace. */
  trimStart(): Str8 {
    return Str8.trimStartRange(this.buffer, this.start, this.end);
  }

  /** Remove trailing whitespace. */
  trimEnd(): Str8 {
    return Str8.trimEndRange(this.buffer, this.start, this.end);
  }

  /** Remove leading and trailing whitespace and line terminators. */
  trim(): Str8 {
    return Str8.trimRange(this.buffer, this.start, this.end);
  }

  /** Alias of {@link Str8#trimStart}, matching native `String#trimLeft`. */
  trimLeft(): Str8 {
    return Str8.trimStartRange(this.buffer, this.start, this.end);
  }

  /** Alias of {@link Str8#trimEnd}, matching native `String#trimRight`. */
  trimRight(): Str8 {
    return Str8.trimEndRange(this.buffer, this.start, this.end);
  }

  /**
   * Whether byte `index` lands on a codepoint boundary (Rust
   * `str::is_char_boundary`). The ends count as boundaries.
   */
  isCharBoundary(index: i32): bool {
    if (index < 0) return false;
    return rangeIsCharBoundary(this.start, this.end, <usize>index);
  }

  /**
   * Return the Unicode code point starting at byte `index`.
   *
   * @param index - byte index of a codepoint's lead byte.
   * @returns The code point, or -1 if `index` is out of range.
   */
  codePointAt(index: i32): i32 {
    return Str8.codePointAtRange(this.start, this.end, index);
  }

  /**
   * Return the raw byte at `index` (Go `s[i]`), or -1 if out of range.
   */
  byteAt(index: i32): i32 {
    return Str8.byteAtRange(this.start, this.end, index);
  }

  /**
   * Return the byte offset of the first occurrence of `search`, or -1.
   *
   * @param search - substring to search for; a `string`, `Str8` or `ArrayBuffer`.
   * @param start  - byte offset to begin searching from.
   */
  indexOf<U>(search: U, start: i32 = 0): i32 {
    const n = asView(search);
    return indexOfBytes(this.start, this.end, n.start, n.end, start);
  }

  /**
   * Return the byte offset of the last occurrence of `search`, or -1.
   */
  lastIndexOf<U>(search: U, start: i32 = i32.MAX_VALUE): i32 {
    const n = asView(search);
    return lastIndexOfBytes(this.start, this.end, n.start, n.end, start);
  }

  /** Whether the view contains `search`. */
  includes<U>(search: U): bool {
    return this.indexOf(search) != -1;
  }

  /** Whether the view begins with `search` at the given byte offset. */
  startsWith<U>(search: U, start: i32 = 0): bool {
    const n = asView(search);
    return Str8.startsWithRange(this.start, this.end, n.start, n.end, start);
  }

  /** Whether the view ends with `search` at the given byte position. */
  endsWith<U>(search: U, end: i32 = i32.MAX_VALUE): bool {
    const n = asView(search);
    return Str8.endsWithRange(this.start, this.end, n.start, n.end, end);
  }

  /** Content equality against another view. */
  equals(other: Str8): bool {
    return rangeEquals(this.start, this.end, other.start, other.end);
  }

  /** Content equality against a native `string` (transcoded to UTF-8). */
  equalsString(other: string): bool {
    const n = Str8.from(other);
    return rangeEquals(this.start, this.end, n.start, n.end);
  }

  /**
   * Byte (codepoint) ordering against another view. Matches Rust/Go `Ord`;
   * differs from `str`/`String` UTF-16 order only for astral vs BMP >= U+E000.
   */
  compareTo(other: Str8): i32 {
    return compareBytes(this.start, this.end, other.start, other.end);
  }

  /** Alias of {@link Str8#compareTo} (no locale-aware collation). */
  localeCompare(other: Str8): i32 {
    return compareBytes(this.start, this.end, other.start, other.end);
  }

  /** Concatenate `other` onto the end of the view. */
  concat<U>(other: U): Str8 {
    return Str8.concat<Str8, U>(this, other);
  }

  /** Repeat the view's bytes `count` times. */
  repeat(count: i32 = 0): Str8 {
    return Str8.repeat<Str8>(this, count);
  }

  /** Pad the start of the view with `pad` until it reaches `length` bytes. */
  padStart(length: i32, pad: string = " "): Str8 {
    return Str8.padStart<Str8>(this, length, pad);
  }

  /** Pad the end of the view with `pad` until it reaches `length` bytes. */
  padEnd(length: i32, pad: string = " "): Str8 {
    return Str8.padEnd<Str8>(this, length, pad);
  }

  /** Replace the first occurrence of `search` with `replacement`. */
  replace(search: string, replacement: string): Str8 {
    return Str8.replace<Str8>(this, search, replacement);
  }

  /** Replace every occurrence of `search` with `replacement`. */
  replaceAll(search: string, replacement: string): Str8 {
    return Str8.replaceAll<Str8>(this, search, replacement);
  }

  /** Convert alphabetic characters to uppercase (round-trips through `string`). */
  toUpperCase(): Str8 {
    return Str8.toUpperCase<Str8>(this);
  }

  /** Convert alphabetic characters to lowercase (round-trips through `string`). */
  toLowerCase(): Str8 {
    return Str8.toLowerCase<Str8>(this);
  }

  /**
   * Split the view on `separator`. Each piece is a zero-copy `Str8` view.
   *
   * @param separator - string to split on; an empty separator splits into
   *                    single codepoints.
   * @param limit     - maximum number of pieces to return.
   */
  split(separator: string, limit: i32 = i32.MAX_VALUE): Str8[] {
    return Str8.split<Str8>(this, separator, limit);
  }

  /** `a == b` - content equality of two views. */
  // @ts-ignore: decorator
  @operator("==") static __eq(a: Str8, b: Str8): bool {
    return a.equals(b);
  }
  /** `a != b` - content inequality of two views. */
  // @ts-ignore: decorator
  @operator("!=") static __ne(a: Str8, b: Str8): bool {
    return !a.equals(b);
  }
  /** `a < b` - `true` if `a` sorts before `b` by byte (codepoint) order. */
  // @ts-ignore: decorator
  @operator("<") static __lt(a: Str8, b: Str8): bool {
    return a.compareTo(b) < 0;
  }
  /** `a <= b` - `true` if `a` sorts before or equal to `b`. */
  // @ts-ignore: decorator
  @operator("<=") static __le(a: Str8, b: Str8): bool {
    return a.compareTo(b) <= 0;
  }
  /** `a > b` - `true` if `a` sorts after `b`. */
  // @ts-ignore: decorator
  @operator(">") static __gt(a: Str8, b: Str8): bool {
    return a.compareTo(b) > 0;
  }
  /** `a >= b` - `true` if `a` sorts after or equal to `b`. */
  // @ts-ignore: decorator
  @operator(">=") static __ge(a: Str8, b: Str8): bool {
    return a.compareTo(b) >= 0;
  }
  /** `a + b` - concatenation, returned as a view over a fresh buffer. */
  // @ts-ignore: decorator
  @operator("+") static __add(a: Str8, b: Str8): Str8 {
    return Str8.concat<Str8, Str8>(a, b);
  }
  /** `v[i]` - the raw byte at `i` (Go `s[i]`), or -1 if out of range. */
  // @ts-ignore: decorator
  @operator("[]") __get(index: i32): i32 {
    return Str8.byteAtRange(this.start, this.end, index);
  }

  /** Materialize the view into a native `string` (decodes UTF-8 to UTF-16). */
  toString(): string {
    return U8.decodeUnsafe(this.start, this.end - this.start);
  }

  /** Decode this UTF-8 view into a UTF-16 {@link str} (allocates). */
  toStr(): Str {
    return Str.from(this.toString());
  }

  /** Identity conversion - this view is already a `str8`. */
  toStr8(): Str8 {
    return this;
  }

  /** Free-function form of {@link Str8#slice}. */
  static slice<T>(s: T, start: i32 = 0, end: i32 = i32.MAX_VALUE): Str8 {
    const v = asView(s);
    return Str8.sliceRange(v.buffer, v.start, v.end, start, end);
  }

  /** Free-function form of {@link Str8#substring}. */
  static substring<T>(s: T, start: i32 = 0, end: i32 = i32.MAX_VALUE): Str8 {
    const v = asView(s);
    return Str8.substringRange(v.buffer, v.start, v.end, start, end);
  }

  /** Free-function form of {@link Str8#substr}. */
  static substr<T>(s: T, start: i32 = 0, length: i32 = i32.MAX_VALUE): Str8 {
    const v = asView(s);
    return Str8.substrRange(v.buffer, v.start, v.end, start, length);
  }

  /** Free-function form of {@link Str8#charAt}. */
  static charAt<T>(s: T, index: i32): Str8 {
    const v = asView(s);
    return Str8.charAtRange(v.buffer, v.start, v.end, index);
  }

  /** Free-function form of {@link Str8#at}. */
  static at<T>(s: T, index: i32): Str8 {
    const v = asView(s);
    return Str8.atRange(v.buffer, v.start, v.end, index);
  }

  /** Free-function form of {@link Str8#trim}. */
  static trim<T>(s: T): Str8 {
    const v = asView(s);
    return Str8.trimRange(v.buffer, v.start, v.end);
  }

  /** Free-function form of {@link Str8#trimStart}. */
  static trimStart<T>(s: T): Str8 {
    const v = asView(s);
    return Str8.trimStartRange(v.buffer, v.start, v.end);
  }

  /** Free-function form of {@link Str8#trimEnd}. */
  static trimEnd<T>(s: T): Str8 {
    const v = asView(s);
    return Str8.trimEndRange(v.buffer, v.start, v.end);
  }

  /** Length in bytes. Free-function form of {@link Str8#length}. */
  static length<T>(s: T): i32 {
    const v = asView(s);
    return <i32>(v.end - v.start);
  }

  /** Free-function form of {@link Str8#isEmpty}. */
  static isEmpty<T>(s: T): bool {
    const v = asView(s);
    return v.start == v.end;
  }

  /** Free-function form of {@link Str8#codePointCount}. */
  static codePointCount<T>(s: T): i32 {
    const v = asView(s);
    return rangeCodePointCount(v.start, v.end);
  }

  /** Free-function form of {@link Str8#codePointAt}. */
  static codePointAt<T>(s: T, index: i32): i32 {
    const v = asView(s);
    return Str8.codePointAtRange(v.start, v.end, index);
  }

  /** Free-function form of {@link Str8#byteAt}. */
  static byteAt<T>(s: T, index: i32): i32 {
    const v = asView(s);
    return Str8.byteAtRange(v.start, v.end, index);
  }

  /** Free-function form of {@link Str8#isCharBoundary}. */
  static isCharBoundary<T>(s: T, index: i32): bool {
    if (index < 0) return false;
    const v = asView(s);
    return rangeIsCharBoundary(v.start, v.end, <usize>index);
  }

  /** Free-function form of {@link Str8#indexOf}. */
  static indexOf<T, U>(s: T, search: U, start: i32 = 0): i32 {
    const v = asView(s);
    const n = asView(search);
    return indexOfBytes(v.start, v.end, n.start, n.end, start);
  }

  /** Free-function form of {@link Str8#lastIndexOf}. */
  static lastIndexOf<T, U>(s: T, search: U, start: i32 = i32.MAX_VALUE): i32 {
    const v = asView(s);
    const n = asView(search);
    return lastIndexOfBytes(v.start, v.end, n.start, n.end, start);
  }

  /** Free-function form of {@link Str8#includes}. */
  static includes<T, U>(s: T, search: U): bool {
    return Str8.indexOf(s, search) != -1;
  }

  /** Free-function form of {@link Str8#startsWith}. */
  static startsWith<T, U>(s: T, search: U, start: i32 = 0): bool {
    const v = asView(s);
    const n = asView(search);
    return Str8.startsWithRange(v.start, v.end, n.start, n.end, start);
  }

  /** Free-function form of {@link Str8#endsWith}. */
  static endsWith<T, U>(s: T, search: U, end: i32 = i32.MAX_VALUE): bool {
    const v = asView(s);
    const n = asView(search);
    return Str8.endsWithRange(v.start, v.end, n.start, n.end, end);
  }

  /** Content equality. Free-function form of {@link Str8#equals}. */
  static equals<T, U>(a: T, b: U): bool {
    const va = asView(a);
    const vb = asView(b);
    return rangeEquals(va.start, va.end, vb.start, vb.end);
  }

  /** Byte (codepoint) ordering. Free-function form of {@link Str8#compareTo}. */
  static compare<T, U>(a: T, b: U): i32 {
    const va = asView(a);
    const vb = asView(b);
    return compareBytes(va.start, va.end, vb.start, vb.end);
  }

  /** Materialize into a native `string`. Free-function form of {@link Str8#toString}. */
  static toString<T>(s: T): string {
    const v = asView(s);
    return U8.decodeUnsafe(v.start, v.end - v.start);
  }

  /** Free-function form of {@link Str8#concat}. */
  static concat<T, U>(s: T, other: U): Str8 {
    const a = asView(s);
    const b = asView(other);
    const aBytes = a.end - a.start;
    const bBytes = b.end - b.start;
    const out = allocBuffer(aBytes + bBytes);
    const op = changetype<usize>(out);
    copyBytes(op, a.start, aBytes);
    copyBytes(op + aBytes, b.start, bBytes);
    return Str8.fromBuffer(out);
  }

  /** Free-function form of {@link Str8#repeat}. */
  static repeat<T>(s: T, count: i32): Str8 {
    const v = asView(s);
    const bytes = v.end - v.start;
    if (count <= 0 || bytes == 0) return Str8.fromBuffer(allocBuffer(0));
    const out = allocBuffer(bytes * <usize>count);
    let p = changetype<usize>(out);
    for (let i = 0; i < count; i++) {
      copyBytes(p, v.start, bytes);
      p += bytes;
    }
    return Str8.fromBuffer(out);
  }

  /** Free-function form of {@link Str8#padStart}. */
  static padStart<T>(s: T, length: i32, pad: string = " "): Str8 {
    const v = asView(s);
    const viewBytes = <i32>(v.end - v.start);
    if (length <= viewBytes || pad.length == 0) {
      return Str8.fromBuffer(materializeBuffer(v.start, v.end));
    }
    const padBuf = U8.encode(pad);
    const padBytes = <usize>padBuf.byteLength;
    if (padBytes == 0)
      return Str8.fromBuffer(materializeBuffer(v.start, v.end));
    const out = allocBuffer(<usize>length);
    const op = changetype<usize>(out);
    const fillBytes = <usize>(length - viewBytes);
    fillRepeatBytes(op, fillBytes, changetype<usize>(padBuf), padBytes);
    copyBytes(op + fillBytes, v.start, v.end - v.start);
    return Str8.fromBuffer(out);
  }

  /** Free-function form of {@link Str8#padEnd}. */
  static padEnd<T>(s: T, length: i32, pad: string = " "): Str8 {
    const v = asView(s);
    const viewBytes = v.end - v.start;
    const len = <i32>viewBytes;
    if (length <= len || pad.length == 0) {
      return Str8.fromBuffer(materializeBuffer(v.start, v.end));
    }
    const padBuf = U8.encode(pad);
    const padBytes = <usize>padBuf.byteLength;
    if (padBytes == 0)
      return Str8.fromBuffer(materializeBuffer(v.start, v.end));
    const out = allocBuffer(<usize>length);
    const op = changetype<usize>(out);
    copyBytes(op, v.start, viewBytes);
    fillRepeatBytes(
      op + viewBytes,
      <usize>(length - len),
      changetype<usize>(padBuf),
      padBytes,
    );
    return Str8.fromBuffer(out);
  }

  /** Free-function form of {@link Str8#replace}. */
  static replace<T>(s: T, search: string, replacement: string): Str8 {
    const v = asView(s);
    // Empty-search insertion is an edge case; defer it to native.
    if (search.length == 0) {
      return Str8.from(v.toString().replace(search, replacement));
    }
    const searchBuf = U8.encode(search);
    const sBytes = <usize>searchBuf.byteLength;
    const idx = indexOfBytes(
      v.start,
      v.end,
      changetype<usize>(searchBuf),
      changetype<usize>(searchBuf) + sBytes,
      0,
    );
    if (idx < 0) return Str8.fromBuffer(materializeBuffer(v.start, v.end));
    const replBuf = U8.encode(replacement);
    const rBytes = <usize>replBuf.byteLength;
    const viewBytes = v.end - v.start;
    const idxU = <usize>idx;
    const out = allocBuffer(viewBytes - sBytes + rBytes);
    let op = changetype<usize>(out);
    copyBytes(op, v.start, idxU); // before the match
    op += idxU;
    copyBytes(op, changetype<usize>(replBuf), rBytes); // replacement
    op += rBytes;
    const tail = v.start + idxU + sBytes;
    copyBytes(op, tail, v.end - tail); // after the match
    return Str8.fromBuffer(out);
  }

  /** Free-function form of {@link Str8#replaceAll}. */
  static replaceAll<T>(s: T, search: string, replacement: string): Str8 {
    const v = asView(s);
    if (search.length == 0) {
      return Str8.from(v.toString().replaceAll(search, replacement));
    }
    const searchBuf = U8.encode(search);
    const sBytes = <usize>searchBuf.byteLength;

    let count = 0;
    let idx = indexOfBytes(
      v.start,
      v.end,
      changetype<usize>(searchBuf),
      changetype<usize>(searchBuf) + sBytes,
      0,
    );
    while (idx >= 0) {
      count++;
      idx = indexOfBytes(
        v.start,
        v.end,
        changetype<usize>(searchBuf),
        changetype<usize>(searchBuf) + sBytes,
        idx + <i32>sBytes,
      );
    }
    if (count == 0) return Str8.fromBuffer(materializeBuffer(v.start, v.end));

    const replBuf = U8.encode(replacement);
    const rBytes = <usize>replBuf.byteLength;
    const viewBytes = v.end - v.start;
    const out = allocBuffer(
      viewBytes + <usize>count * rBytes - <usize>count * sBytes,
    );
    let op = changetype<usize>(out);
    let prev: usize = 0; // byte offset just past the previous match
    idx = indexOfBytes(
      v.start,
      v.end,
      changetype<usize>(searchBuf),
      changetype<usize>(searchBuf) + sBytes,
      0,
    );
    while (idx >= 0) {
      const segBytes = <usize>idx - prev;
      copyBytes(op, v.start + prev, segBytes);
      op += segBytes;
      copyBytes(op, changetype<usize>(replBuf), rBytes);
      op += rBytes;
      prev = <usize>idx + sBytes;
      idx = indexOfBytes(
        v.start,
        v.end,
        changetype<usize>(searchBuf),
        changetype<usize>(searchBuf) + sBytes,
        <i32>prev,
      );
    }
    const tailStart = v.start + prev;
    copyBytes(op, tailStart, v.end - tailStart); // trailing segment
    return Str8.fromBuffer(out);
  }

  /**
   * Free-function form of {@link Str8#toUpperCase}. An all-ASCII view folds
   * in-place over its bytes (no transcode); otherwise it round-trips through a
   * native `string`.
   */
  static toUpperCase<T>(s: T): Str8 {
    const v = asView(s);
    if (isAsciiRange(v.start, v.end)) {
      const n = v.end - v.start;
      const out = allocBuffer(n);
      asciiCaseFold(changetype<usize>(out), v.start, n, 0x61, 0x7a, -0x20);
      return Str8.fromBuffer(out);
    }
    return Str8.from(v.toString().toUpperCase());
  }

  /**
   * Free-function form of {@link Str8#toLowerCase}. An all-ASCII view folds
   * in-place over its bytes (no transcode); otherwise it round-trips through a
   * native `string`.
   */
  static toLowerCase<T>(s: T): Str8 {
    const v = asView(s);
    if (isAsciiRange(v.start, v.end)) {
      const n = v.end - v.start;
      const out = allocBuffer(n);
      asciiCaseFold(changetype<usize>(out), v.start, n, 0x41, 0x5a, 0x20);
      return Str8.fromBuffer(out);
    }
    return Str8.from(v.toString().toLowerCase());
  }

  /** Free-function form of {@link Str8#split}. */
  static split<T>(s: T, separator: string, limit: i32 = i32.MAX_VALUE): Str8[] {
    const v = asView(s);
    const buffer = v.buffer;
    const start = v.start;
    const end = v.end;
    const out = new Array<Str8>();
    if (limit <= 0) return out;

    if (separator.length == 0) {
      let p = start;
      while (p < end && out.length < limit) {
        let e = p + <usize>utf8SeqLen(load<u8>(p));
        if (e > end) e = end;
        out.push(new Str8(buffer, p, e));
        p = e;
      }
      return out;
    }

    const sepBuf = U8.encode(separator);
    const sepBytes = <usize>sepBuf.byteLength;
    let from: i32 = 0;
    let idx = indexOfBytes(
      start,
      end,
      changetype<usize>(sepBuf),
      changetype<usize>(sepBuf) + sepBytes,
      from,
    );
    while (idx != -1) {
      if (out.length >= limit) return out;
      out.push(new Str8(buffer, start + <usize>from, start + <usize>idx));
      from = idx + <i32>sepBytes;
      idx = indexOfBytes(
        start,
        end,
        changetype<usize>(sepBuf),
        changetype<usize>(sepBuf) + sepBytes,
        from,
      );
    }
    if (out.length < limit) {
      out.push(new Str8(buffer, start + <usize>from, end));
    }
    return out;
  }
}

/**
 * Normalize a `string | Str8 | ArrayBuffer` to a `Str8` view. A `string` is
 * transcoded to a fresh UTF-8 buffer (allocates); a `Str8` is returned as-is; an
 * `ArrayBuffer` is wrapped zero-copy. Mirrors `str`'s `bData/bStart/bEnd`
 * dispatch but cannot be pointer-only, because a native `string` is UTF-16 in
 * memory and must be encoded to view it as UTF-8.
 */
// @ts-ignore: decorator
@inline function asView<T>(s: T): Str8 {
  if (isString<T>()) return Str8.from(changetype<string>(s));
  if (idof<T>() == idof<ArrayBuffer>()) {
    return Str8.fromBuffer(changetype<ArrayBuffer>(s));
  }
  return changetype<Str8>(s);
}

/** Fill `count` bytes at `dst` by repeating `srcBytes` bytes from `src`. */
function fillRepeatBytes(
  dst: usize,
  count: usize,
  src: usize,
  srcBytes: usize,
): void {
  let remaining = count;
  let p = dst;
  while (remaining >= srcBytes) {
    copyBytes(p, src, srcBytes);
    p += srcBytes;
    remaining -= srcBytes;
  }
  if (remaining) copyBytes(p, src, remaining);
}

/**
 * Encoding / interop helpers merged onto `Str8`, mirroring `str.UTF8` /
 * `str.UTF16`. Functions accept a `string`, `Str8` or `ArrayBuffer`.
 */
export namespace Str8 {
  /** UTF-8 access for views (the native storage format). */
  export namespace UTF8 {
    /** Number of bytes the view occupies (its native UTF-8 length). */
    export function byteLength<T>(s: T): i32 {
      const v = asView(s);
      return <i32>(v.end - v.start);
    }
    /** Copy the view's bytes into a fresh owned UTF-8 `ArrayBuffer`. */
    export function encode<T>(s: T): ArrayBuffer {
      const v = asView(s);
      return materializeBuffer(v.start, v.end);
    }
    /** Wrap a UTF-8 `ArrayBuffer` as a zero-copy view. */
    export function decode(buf: ArrayBuffer): Str8 {
      return Str8.fromBuffer(buf);
    }
    /** Whether `buf` holds well-formed UTF-8. */
    export function validate(buf: ArrayBuffer): bool {
      return U8.validate(buf);
    }
  }

  /** UTF-16 interop for views. */
  export namespace UTF16 {
    /** Number of bytes the view would occupy when UTF-16 encoded. */
    export function byteLength<T>(s: T): i32 {
      const v = asView(s);
      return U8.utf16LengthUnsafe(v.start, <i32>(v.end - v.start)) << 1;
    }
    /** Encode the view to a new UTF-16 `ArrayBuffer`. */
    export function encode<T>(s: T): ArrayBuffer {
      const v = asView(s);
      return U16.encode(v.toString());
    }
    /** Decode a UTF-16 `ArrayBuffer` into a UTF-8 view. */
    export function decode(buf: ArrayBuffer): Str8 {
      return Str8.from(U16.decode(buf));
    }
  }

  /** Transcode a UTF-16 {@link str} into a UTF-8 `Str8` (allocates). */
  export function fromStr(v: Str): Str8 {
    return Str8.from(v.toString());
  }
}

/**
 * The lowercase type alias - `Str8` is the class, `str8` the type used in
 * annotations (`: str8`), mirroring how `string` aliases `String` in the
 * standard library.
 */
export type str8 = Str8;

/**
 * Convert any value to a `str8` (UTF-8 view). A `Str8` is returned as-is; a
 * native `string` is transcoded to UTF-8; anything else with a `toString()`
 * (numbers, a `str`, user classes, …) is stringified then encoded. Callable as
 * `str8(x)` thanks to function/namespace merging on the `str8` name.
 *
 * @param x - value to convert.
 * @returns A `str8` view (allocates a UTF-8 buffer for non-`Str8` inputs).
 */
export function str8<T>(x: T): Str8 {
  if (isString<T>()) return Str8.from(changetype<string>(x));
  // `idof` only applies to references, so guard it (AS `instanceof` is a
  // runtime check; this folds at compile time and dead-codes the other arms).
  if (isReference<T>() && idof<T>() == idof<Str8>()) return changetype<Str8>(x);
  // @ts-ignore: isDefined guards the generic toString() (asc-only builtin)
  if (isDefined(x.toString())) return Str8.from(x.toString());
  return Str8.from("");
}

/**
 * The free-function surface, merged onto the `str8` converter so that
 * `str8.from(s)`, `str8.slice(s, …)`, `str8.UTF8`, … resolve under the lowercase
 * `str8` name in BOTH `asc` (via the `str8` -> `Str8` type alias -> class
 * statics) AND the TS language server (via this function+namespace merge). Every
 * member delegates to the `Str8` class; keep these signatures in sync with it.
 */
export namespace str8 {
  // @ts-ignore: re-exported static
  export const MAX_LENGTH: i32 = Str8.MAX_LENGTH;

  export function from(s: string): Str8 {
    return Str8.from(s);
  }
  export function fromBuffer(buf: ArrayBuffer): Str8 {
    return Str8.fromBuffer(buf);
  }
  export function fromBufferChecked(buf: ArrayBuffer): Str8 {
    return Str8.fromBufferChecked(buf);
  }
  export function fromRange(
    buf: ArrayBuffer,
    startByte: usize,
    endByte: usize,
  ): Str8 {
    return Str8.fromRange(buf, startByte, endByte);
  }
  export function fromCodePoint(code: i32): Str8 {
    return Str8.fromCodePoint(code);
  }
  export function fromCharCode(unit: i32, surr: i32 = -1): Str8 {
    return Str8.fromCharCode(unit, surr);
  }
  export function fromStr(v: Str): Str8 {
    return Str8.fromStr(v);
  }

  export function slice<T>(
    s: T,
    start: i32 = 0,
    end: i32 = i32.MAX_VALUE,
  ): Str8 {
    return Str8.slice<T>(s, start, end);
  }
  export function substring<T>(
    s: T,
    start: i32 = 0,
    end: i32 = i32.MAX_VALUE,
  ): Str8 {
    return Str8.substring<T>(s, start, end);
  }
  export function substr<T>(
    s: T,
    start: i32 = 0,
    length: i32 = i32.MAX_VALUE,
  ): Str8 {
    return Str8.substr<T>(s, start, length);
  }
  export function charAt<T>(s: T, index: i32): Str8 {
    return Str8.charAt<T>(s, index);
  }
  export function at<T>(s: T, index: i32): Str8 {
    return Str8.at<T>(s, index);
  }
  export function trim<T>(s: T): Str8 {
    return Str8.trim<T>(s);
  }
  export function trimStart<T>(s: T): Str8 {
    return Str8.trimStart<T>(s);
  }
  export function trimEnd<T>(s: T): Str8 {
    return Str8.trimEnd<T>(s);
  }
  export function split<T>(
    s: T,
    separator: string,
    limit: i32 = i32.MAX_VALUE,
  ): Str8[] {
    return Str8.split<T>(s, separator, limit);
  }
  export function length<T>(s: T): i32 {
    return Str8.length<T>(s);
  }
  export function isEmpty<T>(s: T): bool {
    return Str8.isEmpty<T>(s);
  }
  export function codePointCount<T>(s: T): i32 {
    return Str8.codePointCount<T>(s);
  }
  export function codePointAt<T>(s: T, index: i32): i32 {
    return Str8.codePointAt<T>(s, index);
  }
  export function byteAt<T>(s: T, index: i32): i32 {
    return Str8.byteAt<T>(s, index);
  }
  export function isCharBoundary<T>(s: T, index: i32): bool {
    return Str8.isCharBoundary<T>(s, index);
  }
  export function indexOf<T, U>(s: T, search: U, start: i32 = 0): i32 {
    return Str8.indexOf<T, U>(s, search, start);
  }
  export function lastIndexOf<T, U>(
    s: T,
    search: U,
    start: i32 = i32.MAX_VALUE,
  ): i32 {
    return Str8.lastIndexOf<T, U>(s, search, start);
  }
  export function includes<T, U>(s: T, search: U): bool {
    return Str8.includes<T, U>(s, search);
  }
  export function startsWith<T, U>(s: T, search: U, start: i32 = 0): bool {
    return Str8.startsWith<T, U>(s, search, start);
  }
  export function endsWith<T, U>(
    s: T,
    search: U,
    end: i32 = i32.MAX_VALUE,
  ): bool {
    return Str8.endsWith<T, U>(s, search, end);
  }
  export function equals<T, U>(a: T, b: U): bool {
    return Str8.equals<T, U>(a, b);
  }
  export function compare<T, U>(a: T, b: U): i32 {
    return Str8.compare<T, U>(a, b);
  }
  export function toString<T>(s: T): string {
    return Str8.toString<T>(s);
  }
  export function concat<T, U>(s: T, other: U): Str8 {
    return Str8.concat<T, U>(s, other);
  }
  export function repeat<T>(s: T, count: i32): Str8 {
    return Str8.repeat<T>(s, count);
  }
  export function padStart<T>(s: T, length: i32, pad: string = " "): Str8 {
    return Str8.padStart<T>(s, length, pad);
  }
  export function padEnd<T>(s: T, length: i32, pad: string = " "): Str8 {
    return Str8.padEnd<T>(s, length, pad);
  }
  export function replace<T>(s: T, search: string, replacement: string): Str8 {
    return Str8.replace<T>(s, search, replacement);
  }
  export function replaceAll<T>(
    s: T,
    search: string,
    replacement: string,
  ): Str8 {
    return Str8.replaceAll<T>(s, search, replacement);
  }
  export function toUpperCase<T>(s: T): Str8 {
    return Str8.toUpperCase<T>(s);
  }
  export function toLowerCase<T>(s: T): Str8 {
    return Str8.toLowerCase<T>(s);
  }

  /** UTF-8 access (delegates to {@link Str8.UTF8}). */
  export namespace UTF8 {
    export function byteLength<T>(s: T): i32 {
      return Str8.UTF8.byteLength<T>(s);
    }
    export function encode<T>(s: T): ArrayBuffer {
      return Str8.UTF8.encode<T>(s);
    }
    export function decode(buf: ArrayBuffer): Str8 {
      return Str8.UTF8.decode(buf);
    }
    export function validate(buf: ArrayBuffer): bool {
      return Str8.UTF8.validate(buf);
    }
  }

  /** UTF-16 interop (delegates to {@link Str8.UTF16}). */
  export namespace UTF16 {
    export function byteLength<T>(s: T): i32 {
      return Str8.UTF16.byteLength<T>(s);
    }
    export function encode<T>(s: T): ArrayBuffer {
      return Str8.UTF16.encode<T>(s);
    }
    export function decode(buf: ArrayBuffer): Str8 {
      return Str8.UTF16.decode(buf);
    }
  }
}
