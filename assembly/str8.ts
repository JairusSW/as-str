import {
  copyBytes,
  encodeUtf8,
  utf8ByteLength,
  equals as rangeEquals,
  equalsBytes,
  isAsciiRange as isAscii16Range,
  isWhiteSpace,
  repeatBytes,
} from "./util";
import {
  allocBuffer,
  asciiCaseFold,
  codePointCount as rangeCodePointCount,
  compareBytes,
  cpOf,
  decodeCodePointAt,
  findByte,
  findLastByte,
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
 * native `string`. Byte-backed query needles need no encoding; native string
 * needles use ASCII fast paths where possible and otherwise encode to UTF-8.
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
    const buf = encodeUtf8(s);
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
    if (!U8.validate(buf)) {
      throw new Error("Str8.fromBufferChecked: invalid UTF-8");
    }
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

  /** Whether every byte is ASCII. */
  isAscii(): bool {
    return isAsciiRange(this.start, this.end);
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

  /** Shared codepoint-indexed slice implementation. @internal */
  static sliceCharsRange(
    buffer: ArrayBuffer,
    start: usize,
    end: usize,
    lo0: i32,
    hi0: i32,
  ): Str8 {
    // Resolve negative bounds from the end, without counting/scanning the prefix.
    // Unsigned subtraction also handles i32.MIN_VALUE without signed overflow.
    const bs =
      lo0 < 0
        ? byteOffsetFromEnd(start, end, 0 - <u32>lo0)
        : byteOffsetOfChar(start, end, lo0);
    const be =
      hi0 < 0
        ? byteOffsetFromEnd(start, end, 0 - <u32>hi0)
        : hi0 == i32.MAX_VALUE
          ? end
          : lo0 >= 0
            ? hi0 <= lo0
              ? bs
              : byteOffsetOfChar(bs, end, hi0 - lo0)
            : byteOffsetOfChar(start, end, hi0);
    return new Str8(buffer, bs, max(bs, be));
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

  /** Codepoint-indexed slice that always returns valid UTF-8 boundaries. */
  sliceChars(start: i32 = 0, end: i32 = i32.MAX_VALUE): Str8 {
    return Str8.sliceCharsRange(this.buffer, this.start, this.end, start, end);
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

  /** Packed `(codepoint << 32) | byteWidth` at byte `index`; width 0 if absent. */
  nextCodePoint(index: i32): u64 {
    if (<u32>index >= <u32>(this.end - this.start)) return 0;
    return decodeCodePointAt(this.start + <usize>index, this.end);
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
    if (isString<U>()) {
      return indexOfNative(
        this.start,
        this.end,
        changetype<string>(search),
        start,
      );
    }
    const n = asView(search);
    return indexOfBytes(this.start, this.end, n.start, n.end, start);
  }

  /**
   * Return the byte offset of the last occurrence of `search`, or -1.
   */
  lastIndexOf<U>(search: U, start: i32 = i32.MAX_VALUE): i32 {
    if (isString<U>()) {
      return lastIndexOfNative(
        this.start,
        this.end,
        changetype<string>(search),
        start,
      );
    }
    const n = asView(search);
    return lastIndexOfBytes(this.start, this.end, n.start, n.end, start);
  }

  /** Whether the view contains `search`. */
  includes<U>(search: U, position: i32 = 0): bool {
    return this.indexOf(search, position) != -1;
  }

  /** View before the first `search`, or empty if absent. */
  before<U>(search: U): Str8 {
    const i = this.indexOf(search);
    return i < 0
      ? new Str8(this.buffer, this.start, this.start)
      : this.slice(0, i);
  }

  /** View after the first `search`, or empty if absent. */
  after<U>(search: U): Str8 {
    const i = this.indexOf(search);
    if (i < 0) return new Str8(this.buffer, this.end, this.end);
    return this.slice(i + needleByteLength(search));
  }

  /** View between the first `open` and the next `close`, or empty if absent. */
  between<U, V>(open: U, close: V): Str8 {
    const lo = this.indexOf(open);
    if (lo < 0) return new Str8(this.buffer, this.start, this.start);
    const bodyStart = lo + needleByteLength(open);
    const hi = this.indexOf(close, bodyStart);
    return hi < 0
      ? new Str8(this.buffer, this.end, this.end)
      : this.slice(bodyStart, hi);
  }

  /** View before the last `search`, or empty if absent. */
  beforeLast<U>(search: U): Str8 {
    const i = this.lastIndexOf(search);
    return i < 0
      ? new Str8(this.buffer, this.start, this.start)
      : this.slice(0, i);
  }

  /** View after the last `search`, or empty if absent. */
  afterLast<U>(search: U): Str8 {
    const i = this.lastIndexOf(search);
    if (i < 0) return new Str8(this.buffer, this.end, this.end);
    return this.slice(i + needleByteLength(search));
  }

  /** View between the last `open` before the last `close`, or empty if absent. */
  betweenLast<U, V>(open: U, close: V): Str8 {
    const hi = this.lastIndexOf(close);
    if (hi < 0) return new Str8(this.buffer, this.end, this.end);
    const lo = this.lastIndexOf(open, hi);
    if (lo < 0) return new Str8(this.buffer, this.start, this.start);
    return this.slice(lo + needleByteLength(open), hi);
  }

  /** Whether the view begins with `search` at the given byte offset. */
  startsWith<U>(search: U, start: i32 = 0): bool {
    if (isString<U>()) {
      const at = min(max(start, 0), this.length);
      return startsWithNative(
        this.start + <usize>at,
        this.end,
        changetype<string>(search),
      );
    }
    const n = asView(search);
    return Str8.startsWithRange(this.start, this.end, n.start, n.end, start);
  }

  /** Whether the view ends with `search` at the given byte position. */
  endsWith<U>(search: U, end: i32 = i32.MAX_VALUE): bool {
    if (isString<U>()) {
      const at = min(max(end, 0), this.length);
      return endsWithNative(
        this.start,
        this.start + <usize>at,
        changetype<string>(search),
      );
    }
    const n = asView(search);
    return Str8.endsWithRange(this.start, this.end, n.start, n.end, end);
  }

  /** `a == b` - content equality against another view. */
  // @ts-ignore: decorator
  equals(other: Str8): bool {
    return rangeEquals(this.start, this.end, other.start, other.end);
  }

  /** Content equality against a native `string`; ASCII comparisons allocate nothing. */
  equalsString(other: string): bool {
    return equalsNative(this.start, this.end, other);
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
   * @param limit     - maximum pieces; negative values mean unlimited, as in String.
   */
  split(separator: string | null = null, limit: i32 = i32.MAX_VALUE): Str8[] {
    return Str8.split<Str8>(this, separator, limit);
  }

  // Operator overloads also have named methods for editor compatibility.

  /** Re-point this view at `other`. */
  set(other: Str8): Str8 {
    this.buffer = other.buffer;
    this.start = other.start;
    this.end = other.end;
    return this;
  }

  /** `a != b` - content inequality of two views. */
  // @ts-ignore: decorator
  notEquals(other: Str8): bool {
    return !this.equals(other);
  }

  // Operators accept nullable views so ordinary guards and nullable content
  // comparisons have the same null behavior as native strings.
  // @ts-ignore: decorator
  @operator("==") static operatorEquals(a: Str8 | null, b: Str8 | null): bool {
    if (changetype<usize>(a) == changetype<usize>(b)) return true;
    if (!changetype<usize>(a) || !changetype<usize>(b)) return false;
    return a!.equals(b!);
  }

  // @ts-ignore: decorator
  @operator("!=") static operatorNotEquals(
    a: Str8 | null,
    b: Str8 | null,
  ): bool {
    return !Str8.operatorEquals(a, b);
  }

  /** `a < b` - `true` if this view sorts before `other` by byte (codepoint) order. */
  // @ts-ignore: decorator
  @operator("<") lessThan(other: Str8): bool {
    return this.compareTo(other) < 0;
  }

  /** `a <= b` - `true` if this view sorts before or equal to `other`. */
  // @ts-ignore: decorator
  @operator("<=") lessThanOrEqual(other: Str8): bool {
    return this.compareTo(other) <= 0;
  }

  /** `a > b` - `true` if this view sorts after `other` by byte (codepoint) order. */
  // @ts-ignore: decorator
  @operator(">") greaterThan(other: Str8): bool {
    return this.compareTo(other) > 0;
  }

  /** `a >= b` - `true` if this view sorts after or equal to `other`. */
  // @ts-ignore: decorator
  @operator(">=") greaterThanOrEqual(other: Str8): bool {
    return this.compareTo(other) >= 0;
  }

  /** `a + b` - concatenate into a fresh `Str8` view. */
  // @ts-ignore: decorator
  @operator("+") add(other: Str8): Str8 {
    return Str8.concat<Str8, Str8>(this, other);
  }

  /** `v[i]` - raw byte, or -1 if out of range. */
  // @ts-ignore: decorator
  @operator("[]") get(index: i32): i32 {
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

  /** Free-function form of {@link Str8#sliceChars}. */
  static sliceChars<T>(s: T, start: i32 = 0, end: i32 = i32.MAX_VALUE): Str8 {
    const v = asView(s);
    return Str8.sliceCharsRange(v.buffer, v.start, v.end, start, end);
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
    return needleByteLength(s);
  }

  /** Explicit byte-length alias of {@link Str8#length}. */
  static byteLength<T>(s: T): i32 {
    return needleByteLength(s);
  }

  /** Free-function form of {@link Str8#isEmpty}. */
  static isEmpty<T>(s: T): bool {
    if (isString<T>()) return changetype<string>(s).length == 0;
    if (idof<T>() == idof<ArrayBuffer>())
      return changetype<ArrayBuffer>(s).byteLength == 0;
    const v = changetype<Str8>(s);
    return v.start == v.end;
  }

  /** Free-function form of {@link Str8#codePointCount}. */
  static codePointCount<T>(s: T): i32 {
    if (isString<T>()) {
      const text = changetype<string>(s);
      let count = text.length;
      const start = changetype<usize>(text);
      const end = start + ((<usize>count) << 1);
      if (isAscii16Range(start, end)) return count;
      for (let p = start; p + 2 < end; p += 2) {
        if (
          (load<u16>(p) & 0xfc00) == 0xd800 &&
          (load<u16>(p + 2) & 0xfc00) == 0xdc00
        ) {
          count--;
          p += 2;
        }
      }
      return count;
    }
    if (idof<T>() == idof<ArrayBuffer>()) {
      const buffer = changetype<ArrayBuffer>(s);
      const start = changetype<usize>(buffer);
      return rangeCodePointCount(start, start + <usize>buffer.byteLength);
    }
    const v = asView(s);
    return rangeCodePointCount(v.start, v.end);
  }

  /** Free-function form of {@link Str8#isAscii}. */
  static isAscii<T>(s: T): bool {
    if (isString<T>()) {
      const text = changetype<string>(s);
      const start = changetype<usize>(text);
      return isAscii16Range(start, start + ((<usize>text.length) << 1));
    }
    if (idof<T>() == idof<ArrayBuffer>()) {
      const buffer = changetype<ArrayBuffer>(s);
      const start = changetype<usize>(buffer);
      return isAsciiRange(start, start + <usize>buffer.byteLength);
    }
    const v = asView(s);
    return isAsciiRange(v.start, v.end);
  }

  /** Free-function form of {@link Str8#codePointAt}. */
  static codePointAt<T>(s: T, index: i32): i32 {
    const v = asView(s);
    return Str8.codePointAtRange(v.start, v.end, index);
  }

  /** Free-function form of {@link Str8#nextCodePoint}. */
  static nextCodePoint<T>(s: T, index: i32): u64 {
    const v = asView(s);
    if (<u32>index >= <u32>(v.end - v.start)) return 0;
    return decodeCodePointAt(v.start + <usize>index, v.end);
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
    if (isString<U>()) {
      return indexOfNative(v.start, v.end, changetype<string>(search), start);
    }
    const n = asView(search);
    return indexOfBytes(v.start, v.end, n.start, n.end, start);
  }

  /** Free-function form of {@link Str8#lastIndexOf}. */
  static lastIndexOf<T, U>(s: T, search: U, start: i32 = i32.MAX_VALUE): i32 {
    const v = asView(s);
    if (isString<U>()) {
      return lastIndexOfNative(
        v.start,
        v.end,
        changetype<string>(search),
        start,
      );
    }
    const n = asView(search);
    return lastIndexOfBytes(v.start, v.end, n.start, n.end, start);
  }

  /** Free-function form of {@link Str8#includes}. */
  static includes<T, U>(s: T, search: U, position: i32 = 0): bool {
    return Str8.indexOf(s, search, position) != -1;
  }

  /** Free-function form of {@link Str8#before}. */
  static before<T, U>(s: T, search: U): Str8 {
    return asView(s).before(search);
  }

  /** Free-function form of {@link Str8#after}. */
  static after<T, U>(s: T, search: U): Str8 {
    return asView(s).after(search);
  }

  /** Free-function form of {@link Str8#between}. */
  static between<T, U, V>(s: T, open: U, close: V): Str8 {
    return asView(s).between(open, close);
  }

  /** Free-function form of {@link Str8#beforeLast}. */
  static beforeLast<T, U>(s: T, search: U): Str8 {
    return asView(s).beforeLast(search);
  }

  /** Free-function form of {@link Str8#afterLast}. */
  static afterLast<T, U>(s: T, search: U): Str8 {
    return asView(s).afterLast(search);
  }

  /** Free-function form of {@link Str8#betweenLast}. */
  static betweenLast<T, U, V>(s: T, open: U, close: V): Str8 {
    return asView(s).betweenLast(open, close);
  }

  /** Free-function form of {@link Str8#startsWith}. */
  static startsWith<T, U>(s: T, search: U, start: i32 = 0): bool {
    const v = asView(s);
    if (isString<U>()) {
      const at = min(max(start, 0), v.length);
      return startsWithNative(
        v.start + <usize>at,
        v.end,
        changetype<string>(search),
      );
    }
    const n = asView(search);
    return Str8.startsWithRange(v.start, v.end, n.start, n.end, start);
  }

  /** Free-function form of {@link Str8#endsWith}. */
  static endsWith<T, U>(s: T, search: U, end: i32 = i32.MAX_VALUE): bool {
    const v = asView(s);
    if (isString<U>()) {
      const at = min(max(end, 0), v.length);
      return endsWithNative(
        v.start,
        v.start + <usize>at,
        changetype<string>(search),
      );
    }
    const n = asView(search);
    return Str8.endsWithRange(v.start, v.end, n.start, n.end, end);
  }

  /** Content equality. Free-function form of {@link Str8#equals}. */
  static equals<T, U>(a: T, b: U): bool {
    if (isString<U>()) {
      const va = asView(a);
      return equalsNative(va.start, va.end, changetype<string>(b));
    }
    if (isString<T>()) {
      const vb = asView(b);
      return equalsNative(vb.start, vb.end, changetype<string>(a));
    }
    const va = asView(a);
    const vb = asView(b);
    return rangeEquals(va.start, va.end, vb.start, vb.end);
  }

  /** Byte (codepoint) ordering. Free-function form of {@link Str8#compareTo}. */
  static compare<T, U>(a: T, b: U): i32 {
    if (isString<T>() && isString<U>())
      return compareNativeStrings(changetype<string>(a), changetype<string>(b));
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
    const out = allocBuffer(<u64>aBytes + <u64>bBytes);
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
    const totalBytes = <u64>bytes * <u64>count;
    const out = allocBuffer(totalBytes);
    repeatBytes(changetype<usize>(out), v.start, bytes, <usize>totalBytes);
    return Str8.fromBuffer(out);
  }

  /** Free-function form of {@link Str8#padStart}. */
  static padStart<T>(s: T, length: i32, pad: string = " "): Str8 {
    const v = asView(s);
    const viewBytes = <i32>(v.end - v.start);
    if (length <= viewBytes || pad.length == 0) {
      return Str8.fromBuffer(materializeBuffer(v.start, v.end));
    }
    const padBuf = encodeUtf8(pad);
    const padBytes = <usize>padBuf.byteLength;
    if (padBytes == 0)
      return Str8.fromBuffer(materializeBuffer(v.start, v.end));
    const out = allocBuffer(<usize>length);
    const op = changetype<usize>(out);
    const fillBytes = <usize>(length - viewBytes);
    repeatBytes(op, changetype<usize>(padBuf), padBytes, fillBytes);
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
    const padBuf = encodeUtf8(pad);
    const padBytes = <usize>padBuf.byteLength;
    if (padBytes == 0)
      return Str8.fromBuffer(materializeBuffer(v.start, v.end));
    const out = allocBuffer(<usize>length);
    const op = changetype<usize>(out);
    copyBytes(op, v.start, viewBytes);
    repeatBytes(
      op + viewBytes,
      changetype<usize>(padBuf),
      padBytes,
      <usize>(length - len),
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
    const searchBuf = encodeUtf8(search);
    const sBytes = <usize>searchBuf.byteLength;
    const idx = indexOfBytes(
      v.start,
      v.end,
      changetype<usize>(searchBuf),
      changetype<usize>(searchBuf) + sBytes,
      0,
    );
    if (idx < 0) return Str8.fromBuffer(materializeBuffer(v.start, v.end));
    const replBuf = encodeUtf8(replacement);
    const rBytes = <usize>replBuf.byteLength;
    const viewBytes = v.end - v.start;
    const idxU = <usize>idx;
    const out = allocBuffer(<u64>viewBytes - <u64>sBytes + <u64>rBytes);
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
      // Insert at code point boundaries, as `split("")` does. A UTF-16 round
      // trip would split astral code points into unpaired surrogates.
      const replBuf = encodeUtf8(replacement);
      const rPtr = changetype<usize>(replBuf);
      const rBytes = <usize>replBuf.byteLength;
      let slots: u64 = 1;
      for (let p = v.start; p < v.end; slots++) {
        p += <usize>utf8SeqLen(load<u8>(p));
      }
      const out = allocBuffer(<u64>(v.end - v.start) + slots * <u64>rBytes);
      let op = changetype<usize>(out);
      let p = v.start;
      while (true) {
        copyBytes(op, rPtr, rBytes);
        op += rBytes;
        if (p >= v.end) break;
        let e = p + <usize>utf8SeqLen(load<u8>(p));
        if (e > v.end) e = v.end;
        copyBytes(op, p, e - p);
        op += e - p;
        p = e;
      }
      return Str8.fromBuffer(out);
    }
    const searchBuf = encodeUtf8(search);
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

    const replBuf = encodeUtf8(replacement);
    const rBytes = <usize>replBuf.byteLength;
    const viewBytes = v.end - v.start;
    const out = allocBuffer(
      <u64>viewBytes - <u64>count * <u64>sBytes + <u64>count * <u64>rBytes,
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
  static split<T>(
    s: T,
    separator: string | null = null,
    limit: i32 = i32.MAX_VALUE,
  ): Str8[] {
    const v = asView(s);
    const buffer = v.buffer;
    const start = v.start;
    const end = v.end;
    const out = new Array<Str8>();
    if (limit == 0) return out;
    if (limit < 0) limit = i32.MAX_VALUE;

    if (separator === null) {
      out.push(new Str8(buffer, start, end));
      return out;
    }
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

    if (separator.length == 1) {
      const unit = load<u16>(changetype<usize>(separator));
      if (unit < 0x80) {
        let from = start;
        while (true) {
          const relative = findByte(from, end, <u8>unit);
          if (relative < 0) {
            out.push(new Str8(buffer, from, end));
            return out;
          }
          const at = from + <usize>relative;
          out.push(new Str8(buffer, from, at));
          if (out.length == limit) return out;
          from = at + 1;
        }
      }
    }
    const sepBuf = encodeUtf8(separator);
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
      out.push(new Str8(buffer, start + <usize>from, start + <usize>idx));
      if (out.length == limit) return out;
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

// Length queries must not allocate an encoded buffer just to measure a needle.
// @ts-ignore: decorator
@inline function needleByteLength<T>(needle: T): i32 {
  if (isString<T>())
    return utf8ByteLength(
      changetype<usize>(needle),
      changetype<string>(needle).length,
    );
  if (idof<T>() == idof<ArrayBuffer>())
    return changetype<ArrayBuffer>(needle).byteLength;
  return changetype<Str8>(needle).length;
}

// Return 1 for an ASCII prefix match, 0 for a mismatch, or -1 when a
// non-ASCII unit needs the existing WTF-8 encoder. UTF-8 always needs at least
// as many bytes as the native string has UTF-16 units.
function nativeAsciiPrefix(start: usize, end: usize, needle: string): i32 {
  const units = needle.length;
  if (<usize>units > end - start) return 0;
  const np = changetype<usize>(needle);
  for (let i = 0; i < units; i++) {
    const c = load<u16>(np + ((<usize>i) << 1));
    if (c >= 0x80) return -1;
    if (load<u8>(start + <usize>i) != c) return 0;
  }
  return 1;
}

function equalsNative(start: usize, end: usize, needle: string): bool {
  const ascii = nativeAsciiPrefix(start, end, needle);
  if (ascii >= 0) return ascii == 1 && end - start == <usize>needle.length;
  const encoded = encodeUtf8(needle);
  const size = <usize>encoded.byteLength;
  return (
    size == end - start && equalsBytes(start, changetype<usize>(encoded), size)
  );
}

function startsWithNative(start: usize, end: usize, needle: string): bool {
  const ascii = nativeAsciiPrefix(start, end, needle);
  if (ascii >= 0) return ascii == 1;
  const encoded = encodeUtf8(needle);
  const size = <usize>encoded.byteLength;
  return (
    size <= end - start && equalsBytes(start, changetype<usize>(encoded), size)
  );
}

function endsWithNative(start: usize, end: usize, needle: string): bool {
  const units = needle.length;
  if (<usize>units > end - start) return false;
  const np = changetype<usize>(needle);
  for (let i = 1; i <= units; i++) {
    const c = load<u16>(np + ((<usize>(units - i)) << 1));
    if (c >= 0x80) {
      const encoded = encodeUtf8(needle);
      const size = <usize>encoded.byteLength;
      return (
        size <= end - start &&
        equalsBytes(end - size, changetype<usize>(encoded), size)
      );
    }
    if (load<u8>(end - <usize>i) != c) return false;
  }
  return true;
}

function indexOfNative(
  start: usize,
  end: usize,
  needle: string,
  from: i32,
): i32 {
  const units = needle.length;
  if (units == 0) return 0;
  if (units == 1) {
    const c = load<u16>(changetype<usize>(needle));
    if (c < 0x80) {
      const at = max(from, 0);
      if (<usize>at >= end - start) return -1;
      const found = findByte(start + <usize>at, end, <u8>c);
      return found < 0 ? -1 : at + found;
    }
  }
  const np = changetype<usize>(needle);
  if (
    units <= 32 &&
    end - start <= 1024 &&
    isAscii16Range(np, np + ((<usize>units) << 1))
  ) {
    return indexOfNativeAscii(start, end, needle, from);
  }
  const encoded = encodeUtf8(needle);
  const bp = changetype<usize>(encoded);
  return indexOfBytes(start, end, bp, bp + <usize>encoded.byteLength, from);
}

function lastIndexOfNative(
  start: usize,
  end: usize,
  needle: string,
  from: i32,
): i32 {
  const units = needle.length;
  if (units == 0) return <i32>(end - start);
  if (units == 1) {
    const c = load<u16>(changetype<usize>(needle));
    if (c < 0x80) {
      if (start == end) return -1;
      const at = min(max(from, 0), <i32>(end - start) - 1);
      return findLastByte(start, start + <usize>at + 1, <u8>c);
    }
  }
  const np = changetype<usize>(needle);
  if (
    units <= 32 &&
    end - start <= 1024 &&
    isAscii16Range(np, np + ((<usize>units) << 1))
  ) {
    return lastIndexOfNativeAscii(start, end, needle, from);
  }
  const encoded = encodeUtf8(needle);
  const bp = changetype<usize>(encoded);
  return lastIndexOfBytes(start, end, bp, bp + <usize>encoded.byteLength, from);
}

// The caller has already checked that the native needle is ASCII. Pack four
// UTF-16 units into four bytes without allocating a transcoded buffer.
function equalsNativeAscii(bytes: usize, units: usize, count: usize): bool {
  while (count >= 4) {
    let word = load<u64>(units);
    word = (word | (word >> 8)) & 0x0000ffff0000ffff;
    if (load<u32>(bytes) != <u32>(word | (word >> 16))) return false;
    bytes += 4;
    units += 8;
    count -= 4;
  }
  while (count) {
    if (load<u8>(bytes) != load<u16>(units)) return false;
    bytes++;
    units += 2;
    count--;
  }
  return true;
}

function indexOfNativeAscii(
  start: usize,
  end: usize,
  needle: string,
  from: i32,
): i32 {
  const units = needle.length;
  const np = changetype<usize>(needle);
  const first = <u8>load<u16>(np);
  const last = <u8>load<u16>(np + ((<usize>(units - 1)) << 1));
  let anchor = units - 1;
  while (anchor > 0 && load<u16>(np + ((<usize>anchor) << 1)) == first)
    anchor--;
  const anchorByte = <u8>load<u16>(np + ((<usize>anchor) << 1));
  const limit = <i32>(end - start) - units;
  let at = max(from, 0);
  let failures = 0;
  while (at <= limit) {
    const rel = findByte(
      start + <usize>(at + anchor),
      start + <usize>(limit + anchor) + 1,
      anchorByte,
    );
    if (rel < 0) return -1;
    at += rel;
    const p = start + <usize>at;
    if (
      load<u8>(p) == first &&
      load<u8>(p + <usize>units - 1) == last &&
      equalsNativeAscii(p + 1, np + 2, <usize>(units - 2))
    )
      return at;
    at++;
    // Bound the extra work on repeated prefixes. The byte search can use its
    // wide candidate filter after a few failures, with a single encoding.
    if (++failures == 8 && at <= limit) {
      const encoded = encodeUtf8(needle);
      const bp = changetype<usize>(encoded);
      return indexOfBytes(start, end, bp, bp + <usize>units, at);
    }
  }
  return -1;
}

function lastIndexOfNativeAscii(
  start: usize,
  end: usize,
  needle: string,
  from: i32,
): i32 {
  const units = needle.length;
  const np = changetype<usize>(needle);
  const first = <u8>load<u16>(np);
  const last = <u8>load<u16>(np + ((<usize>(units - 1)) << 1));
  let anchor = units - 1;
  while (anchor > 0 && load<u16>(np + ((<usize>anchor) << 1)) == first)
    anchor--;
  const anchorByte = <u8>load<u16>(np + ((<usize>anchor) << 1));
  let at = min(max(from, 0), <i32>(end - start) - units);
  let failures = 0;
  while (at >= 0) {
    at = findLastByte(
      start + <usize>anchor,
      start + <usize>(at + anchor) + 1,
      anchorByte,
    );
    if (at < 0) return -1;
    const p = start + <usize>at;
    if (
      load<u8>(p) == first &&
      load<u8>(p + <usize>units - 1) == last &&
      equalsNativeAscii(p + 1, np + 2, <usize>(units - 2))
    )
      return at;
    at--;
    if (++failures == 8 && at >= 0) {
      const encoded = encodeUtf8(needle);
      const bp = changetype<usize>(encoded);
      return lastIndexOfBytes(start, end, bp, bp + <usize>units, at);
    }
  }
  return -1;
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

// WTF-8 byte order follows code point order, including lone surrogates.
// Scan equal UTF-16 blocks directly, then decode only the first differing point.
function compareNativeStrings(a: string, b: string): i32 {
  const aStart = changetype<usize>(a),
    bStart = changetype<usize>(b);
  if (aStart == bStart) return 0;
  const aEnd = aStart + ((<usize>a.length) << 1);
  const bEnd = bStart + ((<usize>b.length) << 1);
  // Short ASCII strings have the same order in their UTF-16 byte layout.
  // Reuse the byte comparator without encoding or decoding individual points.
  if (
    a.length <= 64 &&
    b.length <= 64 &&
    isAscii16Range(aStart, aEnd) &&
    isAscii16Range(bStart, bEnd)
  )
    return compareBytes(aStart, aEnd, bStart, bEnd);
  let pa = aStart,
    pb = bStart;
  let remaining = min(a.length, b.length);
  if (ASC_FEATURE_SIMD) {
    while (remaining >= 8) {
      const equal =
        i16x8.bitmask(i16x8.eq(v128.load(pa), v128.load(pb))) & 0xff;
      if (equal != 0xff) {
        const units = ctz(~equal & 0xff);
        pa += (<usize>units) << 1;
        pb += (<usize>units) << 1;
        remaining -= units;
        break;
      }
      pa += 16;
      pb += 16;
      remaining -= 8;
    }
  } else {
    while (remaining >= 4) {
      const diff = load<u64>(pa) ^ load<u64>(pb);
      if (diff) {
        const units = <i32>(ctz(diff) >> 4);
        pa += (<usize>units) << 1;
        pb += (<usize>units) << 1;
        remaining -= units;
        break;
      }
      pa += 8;
      pb += 8;
      remaining -= 4;
    }
  }
  while (remaining && load<u16>(pa) == load<u16>(pb)) {
    pa += 2;
    pb += 2;
    remaining--;
  }
  // A matching high surrogate can pair on only one side of the mismatch or
  // prefix boundary. Include it when decoding the first differing code point.
  if (
    pa > aStart &&
    (load<u16>(pa - 2) & 0xfc00) == 0xd800 &&
    ((pa < aEnd && (load<u16>(pa) & 0xfc00) == 0xdc00) ||
      (pb < bEnd && (load<u16>(pb) & 0xfc00) == 0xdc00))
  ) {
    pa -= 2;
    pb -= 2;
  }
  if (pa == aEnd || pb == bEnd) return pa == aEnd ? (pb == bEnd ? 0 : -1) : 1;
  const left = nativeCodePoint(pa, aEnd),
    right = nativeCodePoint(pb, bEnd);
  return left < right ? -1 : left > right ? 1 : 0;
}

// @ts-ignore: decorator
@inline function nativeCodePoint(p: usize, end: usize): u32 {
  const high = <u32>load<u16>(p);
  if ((high & 0xfc00) == 0xd800 && p + 2 < end) {
    const low = <u32>load<u16>(p + 2);
    if ((low & 0xfc00) == 0xdc00)
      return 0x10000 + ((high - 0xd800) << 10) + low - 0xdc00;
  }
  return high;
}

function byteOffsetOfChar(start: usize, end: usize, index: i32): usize {
  // A scalar occupies at least one byte, so oversized bounds clamp immediately.
  if (<usize>index >= end - start) return end;
  let p = start;
  let i = 0;
  while (p < end && i < index) {
    p += <usize>widthOf(decodeCodePointAt(p, end));
    i++;
  }
  return p;
}

function byteOffsetFromEnd(start: usize, end: usize, count: u32): usize {
  if (<usize>count >= end - start) return start;
  let p = end;
  while (p > start && count > 0) {
    p = prevCodePointStart(start, p);
    count--;
  }
  return p;
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
      return needleByteLength(s);
    }
    /** Copy the view's bytes into a fresh owned UTF-8 `ArrayBuffer`. */
    export function encode<T>(s: T): ArrayBuffer {
      if (isString<T>()) return encodeUtf8(changetype<string>(s));
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
      if (isString<T>()) return changetype<string>(s).length << 1;
      const v = asView(s);
      return U8.utf16LengthUnsafe(v.start, <i32>(v.end - v.start)) << 1;
    }
    /** Encode the view to a new UTF-16 `ArrayBuffer`. */
    export function encode<T>(s: T): ArrayBuffer {
      if (isString<T>()) return U16.encode(changetype<string>(s));
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
    return Str8.fromBuffer(Str.UTF8.encode(v));
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
 * native `string` or `Str` view is transcoded directly to UTF-8; anything else
 * with a `toString()` (numbers, user classes, …) is stringified then encoded. Callable as
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
  if (isReference<T>() && idof<T>() == idof<Str>())
    return Str8.fromStr(changetype<Str>(x));
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
  export function sliceChars<T>(
    s: T,
    start: i32 = 0,
    end: i32 = i32.MAX_VALUE,
  ): Str8 {
    return Str8.sliceChars<T>(s, start, end);
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
    separator: string | null = null,
    limit: i32 = i32.MAX_VALUE,
  ): Str8[] {
    return Str8.split<T>(s, separator, limit);
  }
  export function length<T>(s: T): i32 {
    return Str8.length<T>(s);
  }
  export function byteLength<T>(s: T): i32 {
    return Str8.byteLength<T>(s);
  }
  export function isEmpty<T>(s: T): bool {
    return Str8.isEmpty<T>(s);
  }
  export function codePointCount<T>(s: T): i32 {
    return Str8.codePointCount<T>(s);
  }
  export function isAscii<T>(s: T): bool {
    return Str8.isAscii<T>(s);
  }
  export function codePointAt<T>(s: T, index: i32): i32 {
    return Str8.codePointAt<T>(s, index);
  }
  export function nextCodePoint<T>(s: T, index: i32): u64 {
    return Str8.nextCodePoint<T>(s, index);
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
  export function includes<T, U>(s: T, search: U, position: i32 = 0): bool {
    return Str8.includes<T, U>(s, search, position);
  }
  export function before<T, U>(s: T, search: U): Str8 {
    return Str8.before<T, U>(s, search);
  }
  export function after<T, U>(s: T, search: U): Str8 {
    return Str8.after<T, U>(s, search);
  }
  export function between<T, U, V>(s: T, open: U, close: V): Str8 {
    return Str8.between<T, U, V>(s, open, close);
  }
  export function beforeLast<T, U>(s: T, search: U): Str8 {
    return Str8.beforeLast<T, U>(s, search);
  }
  export function afterLast<T, U>(s: T, search: U): Str8 {
    return Str8.afterLast<T, U>(s, search);
  }
  export function betweenLast<T, U, V>(s: T, open: U, close: V): Str8 {
    return Str8.betweenLast<T, U, V>(s, open, close);
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
