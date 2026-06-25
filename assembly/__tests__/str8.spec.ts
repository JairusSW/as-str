// Behavioral tests for the UTF-8 virtual string core. `str8` is byte-indexed
// (Rust `&str` / Go `string`): for ASCII data, byte offsets equal native
// `String` char indices, so native methods are the oracle; for multi-byte data
// the oracle is the UTF-8 byte layout (`String.UTF8.byteLength` of a prefix
// gives the expected byte offset).

import { describe, test, expect } from "as-test";
import { str, str8 } from "../index";

const SAMPLE = "hello, world"; // pure ASCII: byte offset == char index
const MULTI = "xx héllo, 世界 😀 yy"; // mixed 1/2/3/4-byte codepoints

describe("str8 views (zero-copy, byte-indexed)", () => {
  test("slice matches String#slice for ASCII", () => {
    expect(str8.slice(SAMPLE, 2).toString()).toBe(SAMPLE.slice(2));
    expect(str8.slice(SAMPLE, 0, 5).toString()).toBe(SAMPLE.slice(0, 5));
    expect(str8.slice(SAMPLE, -5).toString()).toBe(SAMPLE.slice(-5));
    expect(str8.slice(SAMPLE, -5, -1).toString()).toBe(SAMPLE.slice(-5, -1));
    expect(str8.slice(SAMPLE, 8, 2).toString()).toBe(SAMPLE.slice(8, 2));
  });

  test("slice cuts on byte boundaries (multi-byte)", () => {
    // "héllo": bytes h(0) é(1,2) l(3) l(4) o(5)
    const v = str8.from("héllo");
    expect(v.length).toBe(6); // bytes, not chars
    expect(v.slice(0, 3).toString()).toBe("hé"); // bytes [0,3)
    expect(v.slice(3).toString()).toBe("llo");
  });

  test("substring / substr (ASCII)", () => {
    expect(str8.substring(SAMPLE, 7).toString()).toBe(SAMPLE.substring(7));
    expect(str8.substring(SAMPLE, 7, 2).toString()).toBe(
      SAMPLE.substring(7, 2),
    );
    expect(str8.substr(SAMPLE, 7, 3).toString()).toBe(SAMPLE.substr(7, 3));
    expect(str8.substr(SAMPLE, -5, 2).toString()).toBe(SAMPLE.substr(-5, 2));
  });

  test("charAt / at return a single codepoint view", () => {
    expect(str8.charAt(SAMPLE, 0).toString()).toBe("h");
    expect(str8.charAt(SAMPLE, 99).toString()).toBe("");
    expect(str8.at(SAMPLE, -1).toString()).toBe("d");
    // charAt at the lead byte of a multi-byte codepoint yields the whole char
    const v = str8.from("héllo");
    expect(v.charAt(1).toString()).toBe("é");
    expect(v.at(-1).toString()).toBe("o");
  });

  test("trim family matches String#trim* (ASCII whitespace)", () => {
    const padded = "  \t hi there \n ";
    expect(str8.trim(padded).toString()).toBe(padded.trim());
    expect(str8.trimStart(padded).toString()).toBe(padded.trimStart());
    expect(str8.trimEnd(padded).toString()).toBe(padded.trimEnd());
    // trim leaves multi-byte content intact
    expect(str8.from("  héllo, 世界  ").trim().toString()).toBe("héllo, 世界");
  });

  test("a view of a view stays anchored to the original buffer", () => {
    const w = str8.slice(SAMPLE, 7); // "world"
    expect(w.toString()).toBe("world");
    expect(w.slice(1, 4).toString()).toBe("orl");
    const root = str8.from(SAMPLE);
    const a = root.slice(7);
    expect(changetype<usize>(a.buffer) == changetype<usize>(root.buffer)).toBe(
      true,
    );
  });
});

describe("str8 queries", () => {
  test("length is bytes; codePointCount is scalars", () => {
    expect(str8.length(SAMPLE)).toBe(SAMPLE.length); // ASCII: equal
    expect(str8.from(MULTI).byteLength).toBe(String.UTF8.byteLength(MULTI));
    expect(str8.isEmpty("")).toBe(true);
    expect(str8.slice(SAMPLE, 3, 3).isEmpty).toBe(true);
    const v = str8.from("héllo");
    expect(v.byteLength).toBe(6);
    expect(v.codePointCount()).toBe(5);
  });

  test("codePointAt / byteAt", () => {
    expect(str8.codePointAt(SAMPLE, 0)).toBe(SAMPLE.codePointAt(0));
    // 😀 starts at its byte offset within MULTI
    const at = String.UTF8.byteLength("xx héllo, 世界 ");
    expect(str8.from(MULTI).codePointAt(at)).toBe(0x1f600);
    // byteAt returns raw bytes; 'é' lead byte is 0xC3
    const v = str8.from("héllo");
    expect(v.byteAt(0)).toBe(0x68); // 'h'
    expect(v.byteAt(1)).toBe(0xc3);
    expect(v.byteAt(99)).toBe(-1);
  });

  test("isCharBoundary (Rust-style)", () => {
    const v = str8.from("😀"); // 4 bytes F0 9F 98 80
    expect(v.isCharBoundary(0)).toBe(true);
    expect(v.isCharBoundary(1)).toBe(false);
    expect(v.isCharBoundary(2)).toBe(false);
    expect(v.isCharBoundary(4)).toBe(true);
    expect(v.isCharBoundary(-1)).toBe(false);
  });

  test("indexOf / lastIndexOf / includes return byte offsets", () => {
    expect(str8.indexOf(SAMPLE, "o")).toBe(SAMPLE.indexOf("o")); // ASCII
    expect(str8.indexOf(SAMPLE, "o", 6)).toBe(SAMPLE.indexOf("o", 6));
    expect(str8.indexOf(SAMPLE, "zzz")).toBe(-1);
    expect(str8.lastIndexOf(SAMPLE, "o")).toBe(SAMPLE.lastIndexOf("o"));
    expect(str8.includes(SAMPLE, "wor")).toBe(true);
    // multi-byte: byte offset of "llo" in "héllo" is 3, not the char index 2
    expect(str8.from("héllo").indexOf("llo")).toBe(
      String.UTF8.byteLength("hé"),
    );
  });

  test("startsWith / endsWith", () => {
    expect(str8.startsWith(SAMPLE, "hello")).toBe(true);
    expect(str8.startsWith(SAMPLE, "world", 7)).toBe(true);
    expect(str8.endsWith(SAMPLE, "world")).toBe(true);
    expect(str8.endsWith(SAMPLE, "hello", 5)).toBe(true);
    expect(str8.from(MULTI).startsWith("xx ")).toBe(true);
    expect(str8.from(MULTI).endsWith(" yy")).toBe(true);
  });

  test("equality and ordering operate on content (byte order)", () => {
    const a = str8.slice(SAMPLE, 7); // "world"
    const b = str8.slice("xxworld", 2); // "world", different backing buffer
    expect(a.equals(b)).toBe(true);
    expect(a == b).toBe(true);
    expect(str8.slice("apple", 0) < str8.from("banana")).toBe(true);
    expect(a.equalsString("world")).toBe(true);
    // byte order matches Rust/Go for ASCII and BMP
    expect(str8.compare("abc", "abd")).toBe(-1);
    expect(str8.compare("abc", "abc")).toBe(0);
  });

  test("operators: <= >= [] +", () => {
    const a: str8 = str8.from("alpha");
    const b: str8 = str8.from("beta");
    expect(a <= b).toBe(true);
    expect(b >= a).toBe(true);
    expect(a <= str8.from("alpha")).toBe(true);
    expect(a >= str8.from("alpha")).toBe(true);
    // [] indexes a raw byte (Go s[i])
    const v = str8.from(SAMPLE);
    expect(v[0]).toBe(<i32>SAMPLE.charCodeAt(0));
    expect(v[7]).toBe(<i32>SAMPLE.charCodeAt(7));
    expect(v[999]).toBe(-1);
    expect((str8.from("foo") + str8.from("bar")).toString()).toBe("foobar");
  });
});

describe("str8 namespace accepts string | str8 | ArrayBuffer", () => {
  test("primary argument may already be a view", () => {
    const v: str8 = str8.from(SAMPLE);
    expect(str8.slice(v, 7).toString()).toBe("world");
    expect(str8.length(v)).toBe(SAMPLE.length);
    expect(str8.indexOf(v, "world")).toBe(7);
  });

  test("primary argument may be a raw UTF-8 ArrayBuffer", () => {
    const buf = str8.UTF8.encode(str8.from("hello, world"));
    expect(str8.slice(buf, 7).toString()).toBe("world");
    expect(str8.indexOf(buf, "world")).toBe(7);
    expect(str8.length(buf)).toBe(12);
  });
});

describe("str8 allocating helpers", () => {
  test("concat / repeat", () => {
    expect(str8.concat("foo", "bar").toString()).toBe("foobar");
    expect(str8.concat("", "bar").toString()).toBe("bar");
    expect(str8.concat("foo", "").toString()).toBe("foo");
    expect(str8.concat(str8.slice("xxfoo", 2), "bar").toString()).toBe(
      "foobar",
    );
    expect(str8.repeat("ab", 3).toString()).toBe("ababab");
    expect(str8.repeat("ab", 0).toString()).toBe("");
    expect(str8.repeat("ab", 1).toString()).toBe("ab");
  });

  test("padStart / padEnd pad to a byte length", () => {
    expect(str8.from("7").padStart(3, "0").toString()).toBe("007");
    expect(str8.from("7").padEnd(3, "0").toString()).toBe("700");
    expect(str8.from("ab").padStart(2, "0").toString()).toBe("ab"); // no-op
    expect(str8.from("ab").padStart(5, "xy").toString()).toBe("xyxab");
  });

  test("replace / replaceAll (byte splice, multi-byte aware)", () => {
    expect(str8.from("a-b-c").replace("-", "+").toString()).toBe("a+b-c");
    expect(str8.from("a-b-c").replaceAll("-", "+").toString()).toBe("a+b+c");
    // replacement longer than the match
    expect(str8.from("a-b").replace("-", "😀").toString()).toBe("a😀b");
    // multi-byte needle, shorter replacement
    expect(str8.from("a😀b😀c").replaceAll("😀", "-").toString()).toBe("a-b-c");
  });

  test("case folding round-trips through native String", () => {
    // non-ASCII -> round-trip path; short ASCII -> scalar fold tail
    expect(str8.toUpperCase("héllo").toString()).toBe("héllo".toUpperCase());
    expect(str8.toLowerCase("HeLLo").toString()).toBe("HeLLo".toLowerCase());
    // long ASCII (>16 bytes) -> SIMD + SWAR fold tiers, mixed with non-letters
    const LONG = "The Quick Brown FOX Jumps 0123!@# over THE lazy Dog.";
    expect(str8.toUpperCase(LONG).toString()).toBe(LONG.toUpperCase());
    expect(str8.toLowerCase(LONG).toString()).toBe(LONG.toLowerCase());
    expect(str8.from(LONG).toUpperCase().toString()).toBe(LONG.toUpperCase());
  });
});

describe("str8 split returns zero-copy pieces", () => {
  test("splits on a separator", () => {
    const parts = str8.split("a,bb,ccc", ",");
    expect(parts.length).toBe(3);
    expect(parts[0].toString()).toBe("a");
    expect(parts[1].toString()).toBe("bb");
    expect(parts[2].toString()).toBe("ccc");
  });

  test("multi-byte separator", () => {
    const parts = str8.from("a😀b😀c").split("😀");
    expect(parts.length).toBe(3);
    expect(parts[1].toString()).toBe("b");
  });

  test("limit", () => {
    const parts = str8.from("a,b,c,d").split(",", 2);
    expect(parts.length).toBe(2);
    expect(parts[1].toString()).toBe("b");
  });

  test("empty separator yields each codepoint", () => {
    const parts = str8.from("a😀b").split("");
    expect(parts.length).toBe(3);
    expect(parts[1].toString()).toBe("😀");
  });
});

describe("str8 buffer interop", () => {
  test("fromBuffer is zero-copy", () => {
    const buf = str8.UTF8.encode(str8.from("hello"));
    const w = str8.fromBuffer(buf);
    expect(changetype<usize>(w.buffer) == changetype<usize>(buf)).toBe(true);
    expect(w.toString()).toBe("hello");
  });

  test("UTF8 validate accepts good bytes and rejects bad", () => {
    expect(str8.UTF8.validate(str8.UTF8.encode(str8.from("ok 世界")))).toBe(
      true,
    );
    const bad = new ArrayBuffer(2);
    store<u8>(changetype<usize>(bad), 0xff);
    store<u8>(changetype<usize>(bad) + 1, 0xfe);
    expect(str8.UTF8.validate(bad)).toBe(false);
  });

  test("UTF8 round-trips a view's bytes", () => {
    const view = str8.from(MULTI);
    expect(str8.UTF8.byteLength(view)).toBe(view.byteLength);
    const buf = str8.UTF8.encode(view);
    expect(buf.byteLength).toBe(view.byteLength);
    expect(str8.UTF8.decode(buf).toString()).toBe(MULTI);
  });

  test("UTF16 interop", () => {
    const view = str8.from(MULTI);
    expect(str8.UTF16.byteLength(view)).toBe(MULTI.length << 1);
    const buf = str8.UTF16.encode(view);
    expect(buf.byteLength).toBe(MULTI.length << 1);
    expect(str8.UTF16.decode(buf).toString()).toBe(MULTI);
  });

  test("toStr / fromStr bridge to the UTF-16 str type", () => {
    expect(str8.from("héllo").toStr().toString()).toBe("héllo");
    expect(str8.fromStr(str.from("世界")).toString()).toBe("世界");
  });

  test("str8(x) converter and .toStr8 / .toStr", () => {
    expect(str8("hi").byteLength).toBe(2); // string -> str8
    expect(str8(MULTI).toString()).toBe(MULTI);
    expect(str8<i32>(42).toString()).toBe((42).toString()); // number
    expect(str8(str8.from("x")).toString()).toBe("x"); // identity
    expect(str8(str.from("世界")).toString()).toBe("世界"); // str -> str8
    const u = str8.from("世界");
    expect(u.toStr8().toString()).toBe("世界"); // identity
    expect(u.toStr().toString()).toBe("世界"); // str8 -> str
    const a: str8 = str8("type test"); // usable as a type
    expect(a.byteLength).toBe(9);
  });

  test("constructors and MAX_LENGTH", () => {
    expect(str8.fromCodePoint(0x1f600).toString()).toBe("😀");
    expect(str8.fromCharCode(65).toString()).toBe("A");
    // @ts-expect-error: String.MAX_LENGTH exists in asc (editor sees JS String)
    expect(str8.MAX_LENGTH).toBe(String.MAX_LENGTH);
    expect(str8.toString(MULTI)).toBe(MULTI);
  });
});
