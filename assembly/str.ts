import {
  allocString,
  asciiCaseFold,
  compare as rangeCompare,
  copyBytes,
  equals as rangeEquals,
  equalsBytes,
  indexOf as rangeIndexOf,
  isAsciiRange,
  isWhiteSpace,
  lastIndexOf as rangeLastIndexOf,
  materialize,
  unitLength,
} from "./util";
import { UTF8 as U8, UTF16 as U16 } from "utf-as";
import { Str8 } from "./str8";

/**
 * A virtual (zero-copy) string: a lightweight view into an existing real
 * `string`.
 *
 * A `Str` holds a backing `string` (the GC owner of the bytes) plus a
 * `[start, end)` pair of raw byte pointers describing the slice of that string
 * it represents. View-producing operations (`slice`, `substring`, `charAt`,
 * `trim`, `split`, the `[]`/`+` operators, …) merely move pointers and copy no
 * characters, while allocating operations (`concat`, `repeat`, `padStart`,
 * `replace`, `toUpperCase`, `toString`, …) build a freshly owned real `string`.
 * Query operations (`length`, `indexOf`, `includes`, `equals`, …) allocate
 * nothing. All offsets and lengths are measured in UTF-16 code units and the
 * semantics mirror AssemblyScript's native `String`.
 *
 * The same class is both the type and the API surface. Instance methods operate
 * on a view (`v.slice(2)`), while the mirrored static free-functions accept a
 * `string` or a `Str` as their first argument (`Str.slice(s, 2)`).
 */
// @ts-ignore: decorator
@final export class Str {
  /**
   * Construct a view directly from a backing string and raw byte pointers.
   *
   * @param data  - backing real string; the GC owner of the underlying bytes.
   * @param start - byte pointer to the first code unit of the view.
   * @param end   - byte pointer one past the last code unit (exclusive).
   */
  constructor(
    public data: string,
    public start: usize,
    public end: usize,
  ) {}

  /**
   * Wrap an entire real `string` as a zero-copy view over its full length.
   *
   * @param s - backing string to view.
   * @returns A view covering all of `s` (no copy).
   */
  static from(s: string): Str {
    const ptr = changetype<usize>(s);
    return new Str(s, ptr, ptr + ((<usize>s.length) << 1));
  }

  /**
   * Build a view over a backing string from a code-unit `[start, end)` range.
   *
   * @param s     - backing string to view.
   * @param start - inclusive start code-unit index.
   * @param end   - exclusive end code-unit index.
   * @returns A view of `s` covering `[start, end)` (no copy).
   */
  static fromRange(s: string, start: i32, end: i32): Str {
    const base = changetype<usize>(s);
    return new Str(s, base + ((<usize>start) << 1), base + ((<usize>end) << 1));
  }

  /** Maximum length of a backing string, mirroring `String.MAX_LENGTH`. */
  // @ts-expect-error: exists in asc (the editor resolves the JS String)
  static readonly MAX_LENGTH: i32 = String.MAX_LENGTH;

  // Mirrors of the native `String` static constructors, returning a view over a
  // freshly built backing string.

  /**
   * Build a one- or two-unit string from char codes, then view it.
   *
   * @param unit - UTF-16 code unit (the high surrogate when `surr` is given).
   * @param surr - optional low surrogate code unit, or -1 for none.
   * @returns A view over a freshly allocated string.
   */
  static fromCharCode(unit: i32, surr: i32 = -1): Str {
    return Str.from(String.fromCharCode(unit, surr));
  }
  /**
   * Build a string from an array of UTF-16 code units, then view it.
   *
   * @param units - code units to assemble.
   * @returns A view over a freshly allocated string.
   */
  static fromCharCodes(units: Array<i32>): Str {
    return Str.from(String.fromCharCodes(units));
  }
  /**
   * Build a string from a single Unicode code point, then view it.
   *
   * @param code - Unicode code point.
   * @returns A view over a freshly allocated string.
   */
  static fromCodePoint(code: i32): Str {
    return Str.from(String.fromCodePoint(code));
  }

  /** Length of the view in UTF-16 code units. */
  get length(): i32 {
    return unitLength(this.start, this.end);
  }

  /** Whether the view is empty (zero code units). */
  get isEmpty(): bool {
    return this.end == this.start;
  }

  /**
   * Shared range implementation for `slice`. Negative bounds count from the end
   * and out-of-range bounds clamp into `[0, len]`.
   *
   * @param data  - backing string of the resulting view.
   * @param start - view start byte pointer.
   * @param end   - view end byte pointer.
   * @param lo0   - start code-unit index (negative counts from the end).
   * @param hi0   - end code-unit index (negative counts from the end).
   * @returns A view of the requested slice (no copy).
   * @internal
   */
  static sliceRange(
    data: string,
    start: usize,
    end: usize,
    lo0: i32,
    hi0: i32,
  ): Str {
    const len = unitLength(start, end);
    let lo = lo0 < 0 ? max(len + lo0, 0) : min(lo0, len);
    let hi = hi0 < 0 ? max(len + hi0, 0) : min(hi0, len);
    if (hi < lo) hi = lo;
    return new Str(
      data,
      start + ((<usize>lo) << 1),
      start + ((<usize>hi) << 1),
    );
  }

  /**
   * Shared range implementation for `substring`. Negative bounds clamp to 0 and
   * the bounds are swapped when `lo0 > hi0`.
   *
   * @param data  - backing string of the resulting view.
   * @param start - view start byte pointer.
   * @param end   - view end byte pointer.
   * @param lo0   - first code-unit index.
   * @param hi0   - second code-unit index.
   * @returns A view of the requested substring (no copy).
   * @internal
   */
  static substringRange(
    data: string,
    start: usize,
    end: usize,
    lo0: i32,
    hi0: i32,
  ): Str {
    const len = unitLength(start, end);
    let lo = lo0 < 0 ? 0 : min(lo0, len);
    let hi = hi0 < 0 ? 0 : min(hi0, len);
    if (lo > hi) {
      const t = lo;
      lo = hi;
      hi = t;
    }
    return new Str(
      data,
      start + ((<usize>lo) << 1),
      start + ((<usize>hi) << 1),
    );
  }

  /**
   * Shared range implementation for `substr`. A negative `start0` counts from
   * the end and a negative `length` yields an empty view.
   *
   * @param data   - backing string of the resulting view.
   * @param start  - view start byte pointer.
   * @param end    - view end byte pointer.
   * @param start0 - start code-unit index (negative counts from the end).
   * @param length - number of code units to include.
   * @returns A view of the requested substring (no copy).
   * @internal
   */
  static substrRange(
    data: string,
    start: usize,
    end: usize,
    start0: i32,
    length: i32,
  ): Str {
    const len = unitLength(start, end);
    let lo = start0 < 0 ? max(len + start0, 0) : min(start0, len);
    let count = length < 0 ? 0 : min(length, len - lo);
    return new Str(
      data,
      start + ((<usize>lo) << 1),
      start + ((<usize>(lo + count)) << 1),
    );
  }

  /**
   * Shared range implementation for `charAt`.
   *
   * @param data  - backing string of the resulting view.
   * @param start - view start byte pointer.
   * @param end   - view end byte pointer.
   * @param index - zero-based code-unit index.
   * @returns A single-code-unit view, or an empty view if out of range.
   * @internal
   */
  static charAtRange(data: string, start: usize, end: usize, index: i32): Str {
    if (<u32>index >= <u32>unitLength(start, end)) {
      return new Str(data, start, start);
    }
    const at = start + ((<usize>index) << 1);
    return new Str(data, at, at + 2);
  }

  /**
   * Shared range implementation for `at`; supports negative indices.
   *
   * @param data  - backing string of the resulting view.
   * @param start - view start byte pointer.
   * @param end   - view end byte pointer.
   * @param index - code-unit index (negative counts from the end).
   * @returns A single-code-unit view, or an empty view if out of range.
   * @internal
   */
  static atRange(data: string, start: usize, end: usize, index: i32): Str {
    const len = unitLength(start, end);
    if (index < 0) index += len;
    if (<u32>index >= <u32>len) {
      return new Str(data, start, start);
    }
    const at = start + ((<usize>index) << 1);
    return new Str(data, at, at + 2);
  }

  /**
   * Shared range implementation for `trimStart`; skips leading whitespace.
   *
   * @param data  - backing string of the resulting view.
   * @param start - view start byte pointer.
   * @param end   - view end byte pointer.
   * @returns A view with leading whitespace removed (no copy).
   * @internal
   */
  static trimStartRange(data: string, start: usize, end: usize): Str {
    let p = start;
    while (p < end && isWhiteSpace(load<u16>(p))) p += 2;
    return new Str(data, p, end);
  }

  /**
   * Shared range implementation for `trimEnd`; skips trailing whitespace.
   *
   * @param data  - backing string of the resulting view.
   * @param start - view start byte pointer.
   * @param end   - view end byte pointer.
   * @returns A view with trailing whitespace removed (no copy).
   * @internal
   */
  static trimEndRange(data: string, start: usize, end: usize): Str {
    let p = end;
    while (p > start && isWhiteSpace(load<u16>(p - 2))) p -= 2;
    return new Str(data, start, p);
  }

  /**
   * Shared range implementation for `trim`; skips leading and trailing
   * whitespace.
   *
   * @param data  - backing string of the resulting view.
   * @param start - view start byte pointer.
   * @param end   - view end byte pointer.
   * @returns A view with surrounding whitespace removed (no copy).
   * @internal
   */
  static trimRange(data: string, start: usize, end: usize): Str {
    let lo = start;
    let hi = end;
    while (lo < hi && isWhiteSpace(load<u16>(lo))) lo += 2;
    while (hi > lo && isWhiteSpace(load<u16>(hi - 2))) hi -= 2;
    return new Str(data, lo, hi);
  }

  /**
   * Shared range implementation for `charCodeAt`.
   *
   * @param start - view start byte pointer.
   * @param end   - view end byte pointer.
   * @param index - zero-based code-unit index.
   * @returns The UTF-16 code unit at `index`, or -1 if out of range.
   * @internal
   */
  static charCodeAtRange(start: usize, end: usize, index: i32): i32 {
    if (<u32>index >= <u32>unitLength(start, end)) return -1;
    return <i32>load<u16>(start + ((<usize>index) << 1));
  }

  /**
   * Shared range implementation for `codePointAt`; combines surrogate pairs.
   *
   * @param start - view start byte pointer.
   * @param end   - view end byte pointer.
   * @param index - zero-based code-unit index.
   * @returns The Unicode code point at `index`, or -1 if out of range.
   * @internal
   */
  static codePointAtRange(start: usize, end: usize, index: i32): i32 {
    const len = unitLength(start, end);
    if (<u32>index >= <u32>len) return -1;
    const hi = <u32>load<u16>(start + ((<usize>index) << 1));
    if (hi < 0xd800 || hi > 0xdbff || index + 1 == len) return <i32>hi;
    const lo = <u32>load<u16>(start + ((<usize>(index + 1)) << 1));
    if (lo < 0xdc00 || lo > 0xdfff) return <i32>hi;
    return <i32>(((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000);
  }

  /**
   * Shared range implementation for `startsWith`; compares the needle's bytes at
   * a clamped offset.
   *
   * @param start  - haystack view start byte pointer.
   * @param end    - haystack view end byte pointer.
   * @param nStart - needle start byte pointer.
   * @param nEnd   - needle end byte pointer.
   * @param at0    - code-unit offset to test at (clamped to `[0, len]`).
   * @returns `true` if the needle occurs at `at0`.
   * @internal
   */
  static startsWithRange(
    start: usize,
    end: usize,
    nStart: usize,
    nEnd: usize,
    at0: i32,
  ): bool {
    const nBytes = nEnd - nStart;
    const len = <i32>(nBytes >> 1);
    const viewLen = unitLength(start, end);
    const at = at0 < 0 ? 0 : at0 > viewLen ? viewLen : at0;
    if (at + len > viewLen) return false;
    return equalsBytes(start + ((<usize>at) << 1), nStart, nBytes);
  }

  /**
   * Shared range implementation for `endsWith`; compares the needle's bytes
   * ending at a clamped offset.
   *
   * @param start  - haystack view start byte pointer.
   * @param end    - haystack view end byte pointer.
   * @param nStart - needle start byte pointer.
   * @param nEnd   - needle end byte pointer.
   * @param end0   - code-unit position the match must end at (clamped to
   *                 `[0, len]`).
   * @returns `true` if the needle ends at `end0`.
   * @internal
   */
  static endsWithRange(
    start: usize,
    end: usize,
    nStart: usize,
    nEnd: usize,
    end0: i32,
  ): bool {
    const nBytes = nEnd - nStart;
    const len = <i32>(nBytes >> 1);
    const viewLen = unitLength(start, end);
    const hi = end0 < 0 ? 0 : end0 > viewLen ? viewLen : end0;
    const lo = hi - len;
    if (lo < 0) return false;
    return equalsBytes(start + ((<usize>lo) << 1), nStart, nBytes);
  }

  // ---- view-producing methods (return a Str) ---------------------------

  /**
   * Return a section of the view. Negative indices count from the end.
   *
   * @param start - start code-unit index (negative counts from the end).
   * @param end   - end code-unit index, exclusive; defaults to the view's end.
   * @returns A view of the slice (no copy).
   */
  slice(start: i32 = 0, end: i32 = i32.MAX_VALUE): Str {
    return Str.sliceRange(this.data, this.start, this.end, start, end);
  }

  /**
   * Return the substring between two code-unit indices. Negative indices clamp
   * to 0, and the arguments are swapped when `start > end`.
   *
   * @param start - first code-unit index.
   * @param end   - second code-unit index, exclusive; defaults to the view's
   *                end.
   * @returns A view of the substring (no copy).
   */
  substring(start: i32 = 0, end: i32 = i32.MAX_VALUE): Str {
    return Str.substringRange(this.data, this.start, this.end, start, end);
  }

  /**
   * Return a substring beginning at `start` with the given length. A negative
   * `start` counts from the end.
   *
   * @param start  - start code-unit index (negative counts from the end).
   * @param length - number of code units to include.
   * @returns A view of the substring (no copy).
   */
  substr(start: i32 = 0, length: i32 = i32.MAX_VALUE): Str {
    return Str.substrRange(this.data, this.start, this.end, start, length);
  }

  /**
   * Return the code unit at `index` as a view.
   *
   * @param index - zero-based code-unit index.
   * @returns A single-code-unit view, or an empty view if `index` is out of
   *          range (no copy).
   */
  charAt(index: i32): Str {
    return Str.charAtRange(this.data, this.start, this.end, index);
  }

  /**
   * Like {@link Str#charAt} but supports negative indices counting from the
   * end.
   *
   * @param index - code-unit index (negative counts from the end).
   * @returns A single-code-unit view, or an empty view if out of range (no
   *          copy).
   */
  at(index: i32): Str {
    return Str.atRange(this.data, this.start, this.end, index);
  }

  /**
   * Remove leading whitespace.
   *
   * @returns A view with leading whitespace removed (no copy).
   */
  trimStart(): Str {
    return Str.trimStartRange(this.data, this.start, this.end);
  }

  /**
   * Remove trailing whitespace.
   *
   * @returns A view with trailing whitespace removed (no copy).
   */
  trimEnd(): Str {
    return Str.trimEndRange(this.data, this.start, this.end);
  }

  /**
   * Remove leading and trailing whitespace and line terminators.
   *
   * @returns A view with surrounding whitespace removed (no copy).
   */
  trim(): Str {
    return Str.trimRange(this.data, this.start, this.end);
  }

  /**
   * Alias of {@link Str#trimStart}, matching native `String#trimLeft`.
   *
   * @returns A view with leading whitespace removed (no copy).
   */
  trimLeft(): Str {
    return Str.trimStartRange(this.data, this.start, this.end);
  }

  /**
   * Alias of {@link Str#trimEnd}, matching native `String#trimRight`.
   *
   * @returns A view with trailing whitespace removed (no copy).
   */
  trimRight(): Str {
    return Str.trimEndRange(this.data, this.start, this.end);
  }

  // ---- query methods -------------------------------------------------------

  /**
   * Return the UTF-16 code unit at `index`.
   *
   * @param index - zero-based code-unit index.
   * @returns The code unit, or -1 if there is no code unit at `index`.
   */
  charCodeAt(index: i32): i32 {
    return Str.charCodeAtRange(this.start, this.end, index);
  }

  /**
   * Return the Unicode code point at `index`, combining surrogate pairs.
   *
   * @param index - zero-based code-unit index.
   * @returns The code point, or -1 if `index` is out of range.
   */
  codePointAt(index: i32): i32 {
    return Str.codePointAtRange(this.start, this.end, index);
  }

  /**
   * Return the index of the first occurrence of `search`, or -1 if absent.
   * Searching for an empty string returns 0.
   *
   * @param search - substring to search for; a `string` or a `Str`.
   * @param start  - code-unit index to begin searching from; negative clamps to
   *                 0.
   * @returns The first matching code-unit index, or -1.
   */
  indexOf<U>(search: U, start: i32 = 0): i32 {
    return rangeIndexOf(
      this.start,
      this.end,
      bStart(search),
      bEnd(search),
      start,
    );
  }

  /**
   * Return the index of the last occurrence of `search`, or -1 if absent.
   * Searching for an empty string returns the view's length.
   *
   * @param search - substring to search for; a `string` or a `Str`.
   * @param start  - code-unit index to begin searching backwards from.
   * @returns The last matching code-unit index, or -1.
   */
  lastIndexOf<U>(search: U, start: i32 = i32.MAX_VALUE): i32 {
    return rangeLastIndexOf(
      this.start,
      this.end,
      bStart(search),
      bEnd(search),
      start,
    );
  }

  /**
   * Whether the view contains `search`.
   *
   * @param search - substring to look for; a `string` or a `Str`.
   * @returns `true` if `search` occurs in the view.
   */
  includes<U>(search: U): bool {
    return this.indexOf(search) != -1;
  }

  /**
   * Whether the view begins with `search` at the given offset.
   *
   * @param search - prefix to test; a `string` or a `Str`.
   * @param start  - code-unit offset to test at; defaults to 0.
   * @returns `true` if the view starts with `search` at `start`.
   */
  startsWith<U>(search: U, start: i32 = 0): bool {
    return Str.startsWithRange(
      this.start,
      this.end,
      bStart(search),
      bEnd(search),
      start,
    );
  }

  /**
   * Whether the view ends with `search` at the given position.
   *
   * @param search - suffix to test; a `string` or a `Str`.
   * @param end    - code-unit position the match must end at; defaults to the
   *                 view's length.
   * @returns `true` if the view ends with `search` at `end`.
   */
  endsWith<U>(search: U, end: i32 = i32.MAX_VALUE): bool {
    return Str.endsWithRange(
      this.start,
      this.end,
      bStart(search),
      bEnd(search),
      end,
    );
  }

  /**
   * Content equality against another view.
   *
   * @param other - view to compare against.
   * @returns `true` if both views hold the same code units.
   */
  equals(other: Str): bool {
    return rangeEquals(this.start, this.end, other.start, other.end);
  }

  /**
   * Content equality against a real `string`.
   *
   * @param other - string to compare against.
   * @returns `true` if the view holds the same code units as `other`.
   */
  equalsString(other: string): bool {
    const sp = changetype<usize>(other);
    return rangeEquals(
      this.start,
      this.end,
      sp,
      sp + ((<usize>other.length) << 1),
    );
  }

  /**
   * Code-unit ordering against another view.
   *
   * @param other - view to compare against.
   * @returns A negative, zero, or positive value if this view sorts before,
   *          equal to, or after `other`.
   */
  compareTo(other: Str): i32 {
    return rangeCompare(this.start, this.end, other.start, other.end);
  }

  /**
   * Code-unit ordering against another view, matching `String#localeCompare`
   * (no locale-aware collation; ordering is by code unit).
   *
   * @param other - view to compare against.
   * @returns A negative, zero, or positive value if this view sorts before,
   *          equal to, or after `other`.
   */
  localeCompare(other: Str): i32 {
    return rangeCompare(this.start, this.end, other.start, other.end);
  }

  /**
   * Concatenate `other` onto the end of the view.
   *
   * @param other - value to append; a `string` or a `Str`.
   * @returns A freshly allocated real `string`.
   */
  concat<U>(other: U): string {
    return Str.concat<Str, U>(this, other);
  }

  /**
   * Repeat the view's contents `count` times.
   *
   * @param count - number of copies; `0` (or less) yields the empty string.
   * @returns A freshly allocated real `string`.
   */
  repeat(count: i32 = 0): string {
    return Str.repeat<Str>(this, count);
  }

  /**
   * Pad the start of the view with `pad` until it reaches `length` code units.
   *
   * @param length - target length; if not greater than the current length the
   *                 view is returned unchanged.
   * @param pad    - string to pad with; truncated to fit. Defaults to `" "`.
   * @returns A freshly allocated real `string`.
   */
  padStart(length: i32, pad: string = " "): string {
    return Str.padStart<Str>(this, length, pad);
  }

  /**
   * Pad the end of the view with `pad` until it reaches `length` code units.
   *
   * @param length - target length; if not greater than the current length the
   *                 view is returned unchanged.
   * @param pad    - string to pad with; truncated to fit. Defaults to `" "`.
   * @returns A freshly allocated real `string`.
   */
  padEnd(length: i32, pad: string = " "): string {
    return Str.padEnd<Str>(this, length, pad);
  }

  /**
   * Replace the first occurrence of `search` with `replacement`.
   *
   * @param search      - substring to search for.
   * @param replacement - text to substitute for the first match.
   * @returns A freshly allocated real `string`.
   */
  replace(search: string, replacement: string): string {
    return Str.replace<Str>(this, search, replacement);
  }

  /**
   * Replace every occurrence of `search` with `replacement`.
   *
   * @param search      - substring to search for.
   * @param replacement - text to substitute for each match.
   * @returns A freshly allocated real `string`.
   */
  replaceAll(search: string, replacement: string): string {
    return Str.replaceAll<Str>(this, search, replacement);
  }

  /**
   * Convert all alphabetic characters to lowercase.
   *
   * @returns A freshly allocated real `string`.
   */
  toLowerCase(): string {
    return Str.toLowerCase<Str>(this);
  }

  /**
   * Convert all alphabetic characters to uppercase.
   *
   * @returns A freshly allocated real `string`.
   */
  toUpperCase(): string {
    return Str.toUpperCase<Str>(this);
  }

  /**
   * Split the view on `separator`. Unlike native `String#split`, each piece is
   * a zero-copy view rather than an owned string.
   *
   * @param separator - string to split on; an empty separator splits into
   *                    single code units.
   * @param limit     - maximum number of pieces to return.
   * @returns An array of `Str` views (no character copying).
   */
  split(separator: string, limit: i32 = i32.MAX_VALUE): Str[] {
    return Str.split<Str>(this, separator, limit);
  }

  /** `a == b` - content equality of two views. */
  // @ts-ignore: decorator
  @operator("==") static __eq(a: Str, b: Str): bool {
    return a.equals(b);
  }
  /** `a != b` - content inequality of two views. */
  // @ts-ignore: decorator
  @operator("!=") static __ne(a: Str, b: Str): bool {
    return !a.equals(b);
  }
  /** `a < b` - `true` if `a` sorts before `b` by code-unit ordering. */
  // @ts-ignore: decorator
  @operator("<") static __lt(a: Str, b: Str): bool {
    return a.compareTo(b) < 0;
  }
  /** `a <= b` - `true` if `a` sorts before or equal to `b` by code unit. */
  // @ts-ignore: decorator
  @operator("<=") static __le(a: Str, b: Str): bool {
    return a.compareTo(b) <= 0;
  }
  /** `a > b` - `true` if `a` sorts after `b` by code-unit ordering. */
  // @ts-ignore: decorator
  @operator(">") static __gt(a: Str, b: Str): bool {
    return a.compareTo(b) > 0;
  }
  /** `a >= b` - `true` if `a` sorts after or equal to `b` by code unit. */
  // @ts-ignore: decorator
  @operator(">=") static __ge(a: Str, b: Str): bool {
    return a.compareTo(b) >= 0;
  }

  /**
   * `a + b` - concatenation, returned as a view over a freshly owned string.
   *
   * @param a - left operand.
   * @param b - right operand.
   * @returns A view over the newly allocated concatenation.
   */
  // @ts-ignore: decorator
  @operator("+") static __add(a: Str, b: Str): Str {
    return Str.from(Str.concat<Str, Str>(a, b));
  }

  /**
   * `v[i]` - the UTF-16 code unit at `i` (no allocation).
   *
   * @param index - zero-based code-unit index.
   * @returns The code unit, or -1 if `index` is out of range.
   */
  // @ts-ignore: decorator
  @operator("[]") __get(index: i32): i32 {
    return Str.charCodeAtRange(this.start, this.end, index);
  }

  /**
   * Materialize the view into a real `string`.
   *
   * @returns A freshly allocated, owned `string` holding the view's contents.
   */
  toString(): string {
    return materialize(this.start, this.end);
  }

  /** Identity conversion - this view is already a `str`. */
  toStr(): Str {
    return this;
  }

  /** Transcode this UTF-16 view into a UTF-8 {@link str8} (allocates). */
  toStr8(): Str8 {
    return Str8.from(this.toString());
  }

  /**
   * Free-function form of {@link Str#slice}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s     - source; a `string` or a `Str`.
   * @param start - start code-unit index (negative counts from the end).
   * @param end   - end code-unit index, exclusive.
   * @returns A view of the slice (no copy).
   */
  static slice<T>(s: T, start: i32 = 0, end: i32 = i32.MAX_VALUE): Str {
    return Str.sliceRange(bData(s), bStart(s), bEnd(s), start, end);
  }

  /**
   * Free-function form of {@link Str#substring}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s     - source; a `string` or a `Str`.
   * @param start - first code-unit index.
   * @param end   - second code-unit index, exclusive.
   * @returns A view of the substring (no copy).
   */
  static substring<T>(s: T, start: i32 = 0, end: i32 = i32.MAX_VALUE): Str {
    return Str.substringRange(bData(s), bStart(s), bEnd(s), start, end);
  }

  /**
   * Free-function form of {@link Str#substr}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s      - source; a `string` or a `Str`.
   * @param start  - start code-unit index (negative counts from the end).
   * @param length - number of code units to include.
   * @returns A view of the substring (no copy).
   */
  static substr<T>(s: T, start: i32 = 0, length: i32 = i32.MAX_VALUE): Str {
    return Str.substrRange(bData(s), bStart(s), bEnd(s), start, length);
  }

  /**
   * Free-function form of {@link Str#charAt}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s     - source; a `string` or a `Str`.
   * @param index - zero-based code-unit index.
   * @returns A single-code-unit view, or an empty view if out of range.
   */
  static charAt<T>(s: T, index: i32): Str {
    return Str.charAtRange(bData(s), bStart(s), bEnd(s), index);
  }

  /**
   * Free-function form of {@link Str#at}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s     - source; a `string` or a `Str`.
   * @param index - code-unit index (negative counts from the end).
   * @returns A single-code-unit view, or an empty view if out of range.
   */
  static at<T>(s: T, index: i32): Str {
    return Str.atRange(bData(s), bStart(s), bEnd(s), index);
  }

  /**
   * Free-function form of {@link Str#trim}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s - source; a `string` or a `Str`.
   * @returns A view with surrounding whitespace removed (no copy).
   */
  static trim<T>(s: T): Str {
    return Str.trimRange(bData(s), bStart(s), bEnd(s));
  }

  /**
   * Free-function form of {@link Str#trimStart}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s - source; a `string` or a `Str`.
   * @returns A view with leading whitespace removed (no copy).
   */
  static trimStart<T>(s: T): Str {
    return Str.trimStartRange(bData(s), bStart(s), bEnd(s));
  }

  /**
   * Free-function form of {@link Str#trimEnd}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s - source; a `string` or a `Str`.
   * @returns A view with trailing whitespace removed (no copy).
   */
  static trimEnd<T>(s: T): Str {
    return Str.trimEndRange(bData(s), bStart(s), bEnd(s));
  }

  /**
   * Free-function form of {@link Str#split}; `s` may be a `string` or a
   * `Str`. Each piece is a zero-copy view.
   *
   * @param s         - source; a `string` or a `Str`.
   * @param separator - string to split on; an empty separator splits into
   *                    single code units.
   * @param limit     - maximum number of pieces to return.
   * @returns An array of `Str` views (no character copying).
   */
  static split<T>(s: T, separator: string, limit: i32 = i32.MAX_VALUE): Str[] {
    const data = bData(s);
    const start = bStart(s);
    const end = bEnd(s);
    const total = unitLength(start, end);
    const out = new Array<Str>();
    if (limit <= 0) return out;

    const sepLen = separator.length;
    if (sepLen == 0) {
      const n = total < limit ? total : limit;
      for (let i = 0; i < n; i++) {
        out.push(Str.sliceRange(data, start, end, i, i + 1));
      }
      return out;
    }

    const sp = changetype<usize>(separator);
    const spEnd = sp + ((<usize>sepLen) << 1);
    let from = 0;
    let idx = rangeIndexOf(start, end, sp, spEnd, from);
    while (idx != -1) {
      if (out.length >= limit) return out;
      out.push(Str.sliceRange(data, start, end, from, idx));
      from = idx + sepLen;
      idx = rangeIndexOf(start, end, sp, spEnd, from);
    }
    if (out.length < limit) {
      out.push(Str.sliceRange(data, start, end, from, total));
    }
    return out;
  }

  /**
   * Length in UTF-16 code units. Free-function form of {@link Str#length};
   * `s` may be a `string` or a `Str`.
   *
   * @param s - source; a `string` or a `Str`.
   * @returns The code-unit length.
   */
  static length<T>(s: T): i32 {
    return unitLength(bStart(s), bEnd(s));
  }

  /**
   * Free-function form of {@link Str#isEmpty}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s - source; a `string` or a `Str`.
   * @returns `true` if `s` has zero code units.
   */
  static isEmpty<T>(s: T): bool {
    return bStart(s) == bEnd(s);
  }

  /**
   * Free-function form of {@link Str#charCodeAt}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s     - source; a `string` or a `Str`.
   * @param index - zero-based code-unit index.
   * @returns The code unit, or -1 if out of range.
   */
  static charCodeAt<T>(s: T, index: i32): i32 {
    return Str.charCodeAtRange(bStart(s), bEnd(s), index);
  }

  /**
   * Free-function form of {@link Str#codePointAt}; `s` may be a `string` or
   * a `Str`.
   *
   * @param s     - source; a `string` or a `Str`.
   * @param index - zero-based code-unit index.
   * @returns The code point, or -1 if out of range.
   */
  static codePointAt<T>(s: T, index: i32): i32 {
    return Str.codePointAtRange(bStart(s), bEnd(s), index);
  }

  /**
   * Free-function form of {@link Str#indexOf}; `s` and `search` may each be
   * a `string` or a `Str`.
   *
   * @param s      - source; a `string` or a `Str`.
   * @param search - substring to search for; a `string` or a `Str`.
   * @param start  - code-unit index to begin searching from.
   * @returns The first matching code-unit index, or -1.
   */
  static indexOf<T, U>(s: T, search: U, start: i32 = 0): i32 {
    return rangeIndexOf(
      bStart(s),
      bEnd(s),
      bStart(search),
      bEnd(search),
      start,
    );
  }

  /**
   * Free-function form of {@link Str#lastIndexOf}; `s` and `search` may each
   * be a `string` or a `Str`.
   *
   * @param s      - source; a `string` or a `Str`.
   * @param search - substring to search for; a `string` or a `Str`.
   * @param start  - code-unit index to begin searching backwards from.
   * @returns The last matching code-unit index, or -1.
   */
  static lastIndexOf<T, U>(s: T, search: U, start: i32 = i32.MAX_VALUE): i32 {
    return rangeLastIndexOf(
      bStart(s),
      bEnd(s),
      bStart(search),
      bEnd(search),
      start,
    );
  }

  /**
   * Free-function form of {@link Str#includes}; `s` and `search` may each be
   * a `string` or a `Str`.
   *
   * @param s      - source; a `string` or a `Str`.
   * @param search - substring to look for; a `string` or a `Str`.
   * @returns `true` if `search` occurs in `s`.
   */
  static includes<T, U>(s: T, search: U): bool {
    return Str.indexOf(s, search) != -1;
  }

  /**
   * Free-function form of {@link Str#startsWith}; `s` and `search` may each
   * be a `string` or a `Str`.
   *
   * @param s      - source; a `string` or a `Str`.
   * @param search - prefix to test; a `string` or a `Str`.
   * @param start  - code-unit offset to test at.
   * @returns `true` if `s` starts with `search` at `start`.
   */
  static startsWith<T, U>(s: T, search: U, start: i32 = 0): bool {
    return Str.startsWithRange(
      bStart(s),
      bEnd(s),
      bStart(search),
      bEnd(search),
      start,
    );
  }

  /**
   * Free-function form of {@link Str#endsWith}; `s` and `search` may each be
   * a `string` or a `Str`.
   *
   * @param s      - source; a `string` or a `Str`.
   * @param search - suffix to test; a `string` or a `Str`.
   * @param end    - code-unit position the match must end at.
   * @returns `true` if `s` ends with `search` at `end`.
   */
  static endsWith<T, U>(s: T, search: U, end: i32 = i32.MAX_VALUE): bool {
    return Str.endsWithRange(
      bStart(s),
      bEnd(s),
      bStart(search),
      bEnd(search),
      end,
    );
  }

  /**
   * Content equality. Free-function form of {@link Str#equals}; both
   * operands may each be a `string` or a `Str`.
   *
   * @param a - first operand; a `string` or a `Str`.
   * @param b - second operand; a `string` or a `Str`.
   * @returns `true` if both hold the same code units.
   */
  static equals<T, U>(a: T, b: U): bool {
    return rangeEquals(bStart(a), bEnd(a), bStart(b), bEnd(b));
  }

  /**
   * Code-unit ordering. Free-function form of {@link Str#compareTo}; both
   * operands may each be a `string` or a `Str`.
   *
   * @param a - first operand; a `string` or a `Str`.
   * @param b - second operand; a `string` or a `Str`.
   * @returns A negative, zero, or positive value if `a` sorts before, equal to,
   *          or after `b`.
   */
  static compare<T, U>(a: T, b: U): i32 {
    return rangeCompare(bStart(a), bEnd(a), bStart(b), bEnd(b));
  }

  /**
   * Materialize into a real `string`. Free-function form of
   * {@link Str#toString}; `s` may be a `string` or a `Str`.
   *
   * @param s - source; a `string` or a `Str`.
   * @returns A freshly allocated, owned `string`.
   */
  static toString<T>(s: T): string {
    return materialize(bStart(s), bEnd(s));
  }

  /**
   * Free-function form of {@link Str#toUpperCase}; `s` may be a `string` or
   * a `Str`.
   *
   * @param s - source; a `string` or a `Str`.
   * @returns A freshly allocated uppercased `string`.
   */
  static toUpperCase<T>(s: T): string {
    const start = bStart(s);
    const end = bEnd(s);
    // ASCII fast path: fold a-z in one allocate-and-scan pass, skipping the
    // materialize + Unicode-aware native call. Non-ASCII defers to native.
    if (isAsciiRange(start, end)) {
      const bytes = end - start;
      const out = allocString(bytes);
      asciiCaseFold(changetype<usize>(out), start, bytes, 0x61, 0x7a, -0x20);
      return out;
    }
    return materialize(start, end).toUpperCase();
  }

  /**
   * Free-function form of {@link Str#toLowerCase}; `s` may be a `string` or
   * a `Str`.
   *
   * @param s - source; a `string` or a `Str`.
   * @returns A freshly allocated lowercased `string`.
   */
  static toLowerCase<T>(s: T): string {
    const start = bStart(s);
    const end = bEnd(s);
    // ASCII fast path: fold A-Z in one allocate-and-scan pass, skipping the
    // materialize + Unicode-aware native call. Non-ASCII defers to native.
    if (isAsciiRange(start, end)) {
      const bytes = end - start;
      const out = allocString(bytes);
      asciiCaseFold(changetype<usize>(out), start, bytes, 0x41, 0x5a, 0x20);
      return out;
    }
    return materialize(start, end).toLowerCase();
  }

  /**
   * Free-function form of {@link Str#repeat}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s     - source; a `string` or a `Str`.
   * @param count - number of copies; `0` (or less) yields the empty string.
   * @returns A freshly allocated real `string`.
   */
  static repeat<T>(s: T, count: i32): string {
    const start = bStart(s);
    const bytes = bEnd(s) - start;
    if (count <= 0 || bytes == 0) return "";
    const out = allocString(bytes * <usize>count);
    let p = changetype<usize>(out);
    for (let i = 0; i < count; i++) {
      copyBytes(p, start, bytes);
      p += bytes;
    }
    return out;
  }

  /**
   * Free-function form of {@link Str#padStart}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s      - source; a `string` or a `Str`.
   * @param length - target length; if not greater than the current length the
   *                 source is returned unchanged.
   * @param pad    - string to pad with; truncated to fit. Defaults to `" "`.
   * @returns A freshly allocated real `string`.
   */
  static padStart<T>(s: T, length: i32, pad: string = " "): string {
    const start = bStart(s);
    const end = bEnd(s);
    const len = unitLength(start, end);
    if (length <= len || pad.length == 0) return materialize(start, end);
    const out = allocString((<usize>length) << 1);
    const op = changetype<usize>(out);
    const fill = fillRepeat(op, length - len, pad);
    copyBytes(op + ((<usize>fill) << 1), start, end - start);
    return out;
  }

  /**
   * Free-function form of {@link Str#padEnd}; `s` may be a `string` or a
   * `Str`.
   *
   * @param s      - source; a `string` or a `Str`.
   * @param length - target length; if not greater than the current length the
   *                 source is returned unchanged.
   * @param pad    - string to pad with; truncated to fit. Defaults to `" "`.
   * @returns A freshly allocated real `string`.
   */
  static padEnd<T>(s: T, length: i32, pad: string = " "): string {
    const start = bStart(s);
    const end = bEnd(s);
    const viewBytes = end - start;
    const len = unitLength(start, end);
    if (length <= len || pad.length == 0) return materialize(start, end);
    const out = allocString((<usize>length) << 1);
    const op = changetype<usize>(out);
    copyBytes(op, start, viewBytes);
    fillRepeat(op + viewBytes, length - len, pad);
    return out;
  }

  /**
   * Concatenate two values into a freshly owned string. Free-function form of
   * {@link Str#concat}; both operands may each be a `string` or a `Str`.
   *
   * @param s     - left operand; a `string` or a `Str`.
   * @param other - right operand; a `string` or a `Str`.
   * @returns A freshly allocated real `string`.
   */
  static concat<T, U>(s: T, other: U): string {
    const aStart = bStart(s);
    const aBytes = bEnd(s) - aStart;
    const bStart2 = bStart(other);
    const bBytes = bEnd(other) - bStart2;
    const out = allocString(aBytes + bBytes);
    const op = changetype<usize>(out);
    copyBytes(op, aStart, aBytes);
    copyBytes(op + aBytes, bStart2, bBytes);
    return out;
  }

  /**
   * Replace the first occurrence of `search`. Free-function form of
   * {@link Str#replace}; `s` may be a `string` or a `Str`.
   *
   * @param s           - source; a `string` or a `Str`.
   * @param search      - substring to search for.
   * @param replacement - text to substitute for the first match.
   * @returns A freshly allocated real `string`.
   */
  static replace<T>(s: T, search: string, replacement: string): string {
    const start = bStart(s);
    const end = bEnd(s);
    const sLen = search.length;
    // Empty-search insertion is an edge case; defer it to native.
    if (sLen == 0) return materialize(start, end).replace(search, replacement);
    const sp = changetype<usize>(search);
    const sBytes = (<usize>sLen) << 1;
    const idx = rangeIndexOf(start, end, sp, sp + sBytes, 0);
    if (idx < 0) return materialize(start, end);

    const viewBytes = end - start;
    const rBytes = (<usize>replacement.length) << 1;
    const idxBytes = (<usize>idx) << 1;
    const out = allocString(viewBytes - sBytes + rBytes);
    let op = changetype<usize>(out);
    copyBytes(op, start, idxBytes); // before the match
    op += idxBytes;
    copyBytes(op, changetype<usize>(replacement), rBytes); // replacement
    op += rBytes;
    const tail = start + idxBytes + sBytes;
    copyBytes(op, tail, end - tail); // after the match
    return out;
  }

  /**
   * Replace every occurrence of `search`. Free-function form of
   * {@link Str#replaceAll}; `s` may be a `string` or a `Str`.
   *
   * @param s           - source; a `string` or a `Str`.
   * @param search      - substring to search for.
   * @param replacement - text to substitute for each match.
   * @returns A freshly allocated real `string`.
   */
  static replaceAll<T>(s: T, search: string, replacement: string): string {
    const start = bStart(s);
    const end = bEnd(s);
    const sLen = search.length;
    if (sLen == 0) {
      return materialize(start, end).replaceAll(search, replacement);
    }
    const sp = changetype<usize>(search);
    const sBytes = (<usize>sLen) << 1;
    const spEnd = sp + sBytes;

    let count = 0;
    let idx = rangeIndexOf(start, end, sp, spEnd, 0);
    while (idx >= 0) {
      count++;
      idx = rangeIndexOf(start, end, sp, spEnd, idx + sLen);
    }
    if (count == 0) return materialize(start, end);

    const viewUnits = unitLength(start, end);
    const rLen = replacement.length;
    const rBytes = (<usize>rLen) << 1;
    const rp = changetype<usize>(replacement);
    const out = allocString((<usize>(viewUnits + count * (rLen - sLen))) << 1);

    let op = changetype<usize>(out);
    let prev = 0; // code-unit index just past the previous match
    idx = rangeIndexOf(start, end, sp, spEnd, 0);
    while (idx >= 0) {
      const segBytes = (<usize>(idx - prev)) << 1;
      copyBytes(op, start + ((<usize>prev) << 1), segBytes);
      op += segBytes;
      copyBytes(op, rp, rBytes);
      op += rBytes;
      prev = idx + sLen;
      idx = rangeIndexOf(start, end, sp, spEnd, prev);
    }
    const tailStart = start + ((<usize>prev) << 1);
    copyBytes(op, tailStart, end - tailStart); // trailing segment
    return out;
  }
}

// @ts-ignore: decorator
@inline function bData<T>(s: T): string {
  if (isString<T>()) return changetype<string>(s);
  return changetype<Str>(s).data;
}
// @ts-ignore: decorator
@inline function bStart<T>(s: T): usize {
  if (isString<T>()) return changetype<usize>(changetype<string>(s));
  return changetype<Str>(s).start;
}
// @ts-ignore: decorator
@inline function bEnd<T>(s: T): usize {
  if (isString<T>()) {
    const Str = changetype<string>(s);
    return changetype<usize>(Str) + ((<usize>Str.length) << 1);
  }
  return changetype<Str>(s).end;
}

function fillRepeat(dst: usize, count: i32, pad: string): i32 {
  const padBytes = (<usize>pad.length) << 1;
  const pp = changetype<usize>(pad);
  let remaining = (<usize>count) << 1;
  let p = dst;
  while (remaining >= padBytes) {
    copyBytes(p, pp, padBytes);
    p += padBytes;
    remaining -= padBytes;
  }
  if (remaining) copyBytes(p, pp, remaining);
  return count;
}

/**
 * Encoding helpers merged onto `Str`, mirroring `String.UTF8` and
 * `String.UTF16`. Functions accept either a `string` or a `Str` as input.
 */
// Encoding namespaces, merged onto `Str` (mirror `String.UTF8`/`String.UTF16`).
export namespace Str {
  /** UTF-16 encoding/decoding for views and strings. */
  export namespace UTF16 {
    /**
     * Number of bytes the view occupies when UTF-16 encoded.
     *
     * @param s - source; a `string` or a `Str`.
     * @returns The byte length (two bytes per code unit).
     */
    export function byteLength<T>(s: T): i32 {
      return <i32>(bEnd(s) - bStart(s));
    }
    /**
     * Encode the view to a new UTF-16 `ArrayBuffer`.
     *
     * @param s - source; a `string` or a `Str`.
     * @returns A freshly allocated `ArrayBuffer` of the encoded bytes.
     */
    export function encode<T>(s: T): ArrayBuffer {
      const start = bStart(s);
      const bytes = bEnd(s) - start;
      const buf = changetype<ArrayBuffer>(__new(bytes, idof<ArrayBuffer>()));
      U16.encodeUnsafe(start, <i32>(bytes >> 1), changetype<usize>(buf));
      return buf;
    }
    /**
     * Encode `len` UTF-16 code units from `Str` into the caller-owned buffer at
     * `buf`.
     *
     * @param Str - pointer to the source code units.
     * @param len - number of code units to encode.
     * @param buf - pointer to the destination buffer.
     * @returns The number of bytes written.
     * @unsafe Writes through raw pointers without bounds checks.
     */
    // @ts-ignore: decorator
    @unsafe export function encodeUnsafe(
      Str: usize,
      len: i32,
      buf: usize,
    ): usize {
      return U16.encodeUnsafe(Str, len, buf);
    }
    /**
     * Decode a UTF-16 `ArrayBuffer` into a view.
     *
     * @param buf - buffer of UTF-16 bytes.
     * @returns A view over the freshly decoded backing string.
     */
    export function decode(buf: ArrayBuffer): Str {
      return Str.from(U16.decode(buf));
    }
    /**
     * Decode `len` bytes of UTF-16 starting at `buf` into a view.
     *
     * @param buf - pointer to the UTF-16 bytes.
     * @param len - number of bytes to decode.
     * @returns A view over the freshly decoded backing string.
     * @unsafe Reads through raw pointers without bounds checks.
     */
    // @ts-ignore: decorator
    @unsafe export function decodeUnsafe(buf: usize, len: usize): Str {
      return Str.from(U16.decodeUnsafe(buf, len));
    }
    /**
     * Whether the view is well-formed UTF-16 (additional helper from `utf-as`).
     *
     * @param s - source; a `string` or a `Str`.
     * @returns `true` if every surrogate is paired correctly.
     */
    export function validate<T>(s: T): bool {
      const start = bStart(s);
      return U16.validateUnsafe(start, <i32>(bEnd(s) - start));
    }
  }

  /** UTF-8 (WTF-8) encoding/decoding for views and strings. */
  export namespace UTF8 {
    /**
     * Number of bytes the view occupies when UTF-8 encoded.
     *
     * @param s              - source; a `string` or a `Str`.
     * @param nullTerminated - include a trailing NUL byte in the count.
     * @returns The encoded byte length.
     */
    export function byteLength<T>(s: T, nullTerminated: bool = false): i32 {
      const start = bStart(s);
      return U8.byteLengthUnsafe(
        start,
        unitLength(start, bEnd(s)),
        nullTerminated,
      );
    }
    /**
     * Encode the view to a new UTF-8 `ArrayBuffer`.
     *
     * @param s              - source; a `string` or a `Str`.
     * @param nullTerminated - append a trailing NUL byte.
     * @param errorMode      - how to handle lone surrogates; defaults to WTF-8.
     * @returns A freshly allocated `ArrayBuffer` of the encoded bytes.
     */
    export function encode<T>(
      s: T,
      nullTerminated: bool = false,
      errorMode: U8.ErrorMode = U8.ErrorMode.WTF8,
    ): ArrayBuffer {
      const start = bStart(s);
      const len = unitLength(start, bEnd(s));
      const size = U8.byteLengthUnsafe(start, len, nullTerminated);
      const buf = changetype<ArrayBuffer>(
        __new(<usize>size, idof<ArrayBuffer>()),
      );
      U8.encodeUnsafe(
        start,
        len,
        changetype<usize>(buf),
        nullTerminated,
        errorMode,
      );
      return buf;
    }
    /**
     * Encode `len` UTF-16 code units from `Str` as UTF-8 into the caller-owned
     * buffer at `buf`.
     *
     * @param Str            - pointer to the source code units.
     * @param len            - number of code units to encode.
     * @param buf            - pointer to the destination buffer.
     * @param nullTerminated - append a trailing NUL byte.
     * @param errorMode      - how to handle lone surrogates; defaults to WTF-8.
     * @returns The number of bytes written.
     * @unsafe Writes through raw pointers without bounds checks.
     */
    // @ts-ignore: decorator
    @unsafe export function encodeUnsafe(
      Str: usize,
      len: i32,
      buf: usize,
      nullTerminated: bool = false,
      errorMode: U8.ErrorMode = U8.ErrorMode.WTF8,
    ): usize {
      return U8.encodeUnsafe(Str, len, buf, nullTerminated, errorMode);
    }
    /**
     * Decode a UTF-8 `ArrayBuffer` into a view.
     *
     * @param buf            - buffer of UTF-8 bytes.
     * @param nullTerminated - stop decoding at the first NUL byte.
     * @returns A view over the freshly decoded backing string.
     */
    export function decode(
      buf: ArrayBuffer,
      nullTerminated: bool = false,
    ): Str {
      return Str.from(U8.decode(buf, nullTerminated));
    }
    /**
     * Decode `len` bytes of UTF-8 starting at `buf` into a view.
     *
     * @param buf            - pointer to the UTF-8 bytes.
     * @param len            - number of bytes available.
     * @param nullTerminated - stop decoding at the first NUL byte.
     * @returns A view over the freshly decoded backing string.
     * @unsafe Reads through raw pointers without bounds checks.
     */
    // @ts-ignore: decorator
    @unsafe export function decodeUnsafe(
      buf: usize,
      len: usize,
      nullTerminated: bool = false,
    ): Str {
      return Str.from(U8.decodeUnsafe(buf, len, nullTerminated));
    }
    /**
     * Whether `buf` holds well-formed UTF-8.
     *
     * @param buf - buffer of bytes to validate.
     * @returns `true` if the bytes are valid UTF-8.
     */
    export function validate(buf: ArrayBuffer): bool {
      return U8.validate(buf);
    }
    /**
     * Number of UTF-16 code units the UTF-8 buffer would decode to.
     *
     * @param buf - buffer of UTF-8 bytes.
     * @returns The decoded UTF-16 code-unit length.
     */
    export function utf16Length(buf: ArrayBuffer): i32 {
      return U8.utf16Length(buf);
    }
  }
}

/**
 * The lowercase type alias - `Str` is the class, `str` the type used in
 * annotations (`: str`), mirroring how `string` aliases `String` in the
 * standard library.
 */
export type str = Str;

/**
 * Convert any value to a `str` (UTF-16 view). A `Str` is returned as-is; a
 * native `string` is wrapped zero-copy; anything else with a `toString()`
 * (numbers, a `str8`, user classes, …) is stringified then wrapped. Callable as
 * `str(x)` thanks to function/namespace merging on the `str` name.
 *
 * @param x - value to convert.
 * @returns A `str` view.
 */
export function str<T>(x: T): Str {
  if (isString<T>()) return Str.from(changetype<string>(x));
  // `idof` only applies to references, so guard it (AS `instanceof` is a
  // runtime check; this folds at compile time and dead-codes the other arms).
  if (isReference<T>() && idof<T>() == idof<Str>()) return changetype<Str>(x);
  // @ts-ignore: isDefined guards the generic toString() (asc-only builtin)
  if (isDefined(x.toString())) return Str.from(x.toString());
  return Str.from("");
}

/**
 * The free-function surface, merged onto the `str` converter so that
 * `str.from(s)`, `str.slice(s, …)`, `str.UTF8`, … resolve under the lowercase
 * `str` name in BOTH `asc` (via the `str` -> `Str` type alias -> class statics)
 * AND the TS language server (via this function+namespace merge). Every member
 * delegates to the `Str` class; keep these signatures in sync with it.
 */
export namespace str {
  // @ts-ignore: re-exported static
  export const MAX_LENGTH: i32 = Str.MAX_LENGTH;

  export function from(s: string): Str {
    return Str.from(s);
  }
  export function fromCharCode(unit: i32, surr: i32 = -1): Str {
    return Str.fromCharCode(unit, surr);
  }
  export function fromCharCodes(units: Array<i32>): Str {
    return Str.fromCharCodes(units);
  }
  export function fromCodePoint(code: i32): Str {
    return Str.fromCodePoint(code);
  }
  export function fromRange(s: string, start: i32, end: i32): Str {
    return Str.fromRange(s, start, end);
  }

  export function slice<T>(
    s: T,
    start: i32 = 0,
    end: i32 = i32.MAX_VALUE,
  ): Str {
    return Str.slice<T>(s, start, end);
  }
  export function substring<T>(
    s: T,
    start: i32 = 0,
    end: i32 = i32.MAX_VALUE,
  ): Str {
    return Str.substring<T>(s, start, end);
  }
  export function substr<T>(
    s: T,
    start: i32 = 0,
    length: i32 = i32.MAX_VALUE,
  ): Str {
    return Str.substr<T>(s, start, length);
  }
  export function charAt<T>(s: T, index: i32): Str {
    return Str.charAt<T>(s, index);
  }
  export function at<T>(s: T, index: i32): Str {
    return Str.at<T>(s, index);
  }
  export function trim<T>(s: T): Str {
    return Str.trim<T>(s);
  }
  export function trimStart<T>(s: T): Str {
    return Str.trimStart<T>(s);
  }
  export function trimEnd<T>(s: T): Str {
    return Str.trimEnd<T>(s);
  }
  export function split<T>(
    s: T,
    separator: string,
    limit: i32 = i32.MAX_VALUE,
  ): Str[] {
    return Str.split<T>(s, separator, limit);
  }
  export function length<T>(s: T): i32 {
    return Str.length<T>(s);
  }
  export function isEmpty<T>(s: T): bool {
    return Str.isEmpty<T>(s);
  }
  export function charCodeAt<T>(s: T, index: i32): i32 {
    return Str.charCodeAt<T>(s, index);
  }
  export function codePointAt<T>(s: T, index: i32): i32 {
    return Str.codePointAt<T>(s, index);
  }
  export function indexOf<T, U>(s: T, search: U, start: i32 = 0): i32 {
    return Str.indexOf<T, U>(s, search, start);
  }
  export function lastIndexOf<T, U>(
    s: T,
    search: U,
    start: i32 = i32.MAX_VALUE,
  ): i32 {
    return Str.lastIndexOf<T, U>(s, search, start);
  }
  export function includes<T, U>(s: T, search: U): bool {
    return Str.includes<T, U>(s, search);
  }
  export function startsWith<T, U>(s: T, search: U, start: i32 = 0): bool {
    return Str.startsWith<T, U>(s, search, start);
  }
  export function endsWith<T, U>(
    s: T,
    search: U,
    end: i32 = i32.MAX_VALUE,
  ): bool {
    return Str.endsWith<T, U>(s, search, end);
  }
  export function equals<T, U>(a: T, b: U): bool {
    return Str.equals<T, U>(a, b);
  }
  export function compare<T, U>(a: T, b: U): i32 {
    return Str.compare<T, U>(a, b);
  }
  export function toString<T>(s: T): string {
    return Str.toString<T>(s);
  }
  export function toUpperCase<T>(s: T): string {
    return Str.toUpperCase<T>(s);
  }
  export function toLowerCase<T>(s: T): string {
    return Str.toLowerCase<T>(s);
  }
  export function repeat<T>(s: T, count: i32): string {
    return Str.repeat<T>(s, count);
  }
  export function padStart<T>(s: T, length: i32, pad: string = " "): string {
    return Str.padStart<T>(s, length, pad);
  }
  export function padEnd<T>(s: T, length: i32, pad: string = " "): string {
    return Str.padEnd<T>(s, length, pad);
  }
  export function concat<T, U>(s: T, other: U): string {
    return Str.concat<T, U>(s, other);
  }
  export function replace<T>(
    s: T,
    search: string,
    replacement: string,
  ): string {
    return Str.replace<T>(s, search, replacement);
  }
  export function replaceAll<T>(
    s: T,
    search: string,
    replacement: string,
  ): string {
    return Str.replaceAll<T>(s, search, replacement);
  }

  /** UTF-16 encoding/decoding (delegates to {@link Str.UTF16}). */
  export namespace UTF16 {
    export function byteLength<T>(s: T): i32 {
      return Str.UTF16.byteLength<T>(s);
    }
    export function encode<T>(s: T): ArrayBuffer {
      return Str.UTF16.encode<T>(s);
    }
    // @ts-ignore: decorator
    @unsafe export function encodeUnsafe(
      ptr: usize,
      len: i32,
      buf: usize,
    ): usize {
      return Str.UTF16.encodeUnsafe(ptr, len, buf);
    }
    export function decode(buf: ArrayBuffer): Str {
      return Str.UTF16.decode(buf);
    }
    // @ts-ignore: decorator
    @unsafe export function decodeUnsafe(buf: usize, len: usize): Str {
      return Str.UTF16.decodeUnsafe(buf, len);
    }
    export function validate<T>(s: T): bool {
      return Str.UTF16.validate<T>(s);
    }
  }

  /** UTF-8 (WTF-8) encoding/decoding (delegates to {@link Str.UTF8}). */
  export namespace UTF8 {
    export function byteLength<T>(s: T, nullTerminated: bool = false): i32 {
      return Str.UTF8.byteLength<T>(s, nullTerminated);
    }
    export function encode<T>(
      s: T,
      nullTerminated: bool = false,
      errorMode: U8.ErrorMode = U8.ErrorMode.WTF8,
    ): ArrayBuffer {
      return Str.UTF8.encode<T>(s, nullTerminated, errorMode);
    }
    // @ts-ignore: decorator
    @unsafe export function encodeUnsafe(
      ptr: usize,
      len: i32,
      buf: usize,
      nullTerminated: bool = false,
      errorMode: U8.ErrorMode = U8.ErrorMode.WTF8,
    ): usize {
      return Str.UTF8.encodeUnsafe(ptr, len, buf, nullTerminated, errorMode);
    }
    export function decode(
      buf: ArrayBuffer,
      nullTerminated: bool = false,
    ): Str {
      return Str.UTF8.decode(buf, nullTerminated);
    }
    // @ts-ignore: decorator
    @unsafe export function decodeUnsafe(
      buf: usize,
      len: usize,
      nullTerminated: bool = false,
    ): Str {
      return Str.UTF8.decodeUnsafe(buf, len, nullTerminated);
    }
    export function validate(buf: ArrayBuffer): bool {
      return Str.UTF8.validate(buf);
    }
    export function utf16Length(buf: ArrayBuffer): i32 {
      return Str.UTF8.utf16Length(buf);
    }
  }
}
