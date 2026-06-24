// Behavioral tests for the virtual string core. The native `String` methods
// are the oracle: a `vstring` view, once materialized, must agree with what the
// equivalent native operation produces.

import { describe, test, expect } from "as-test";
import { vstring, VString } from "../index";

const SAMPLE = "hello, world";

describe("vstring views (zero-copy)", () => {
  test("slice matches String#slice", () => {
    expect(vstring.slice(SAMPLE, 2).toString()).toBe(SAMPLE.slice(2));
    expect(vstring.slice(SAMPLE, 0, 5).toString()).toBe(SAMPLE.slice(0, 5));
    expect(vstring.slice(SAMPLE, -5).toString()).toBe(SAMPLE.slice(-5));
    expect(vstring.slice(SAMPLE, -5, -1).toString()).toBe(SAMPLE.slice(-5, -1));
    expect(vstring.slice(SAMPLE, 8, 2).toString()).toBe(SAMPLE.slice(8, 2));
  });

  test("substring matches String#substring", () => {
    expect(vstring.substring(SAMPLE, 7).toString()).toBe(SAMPLE.substring(7));
    expect(vstring.substring(SAMPLE, 7, 2).toString()).toBe(
      SAMPLE.substring(7, 2),
    );
    expect(vstring.substring(SAMPLE, -3, 4).toString()).toBe(
      SAMPLE.substring(-3, 4),
    );
  });

  test("substr matches String#substr", () => {
    expect(vstring.substr(SAMPLE, 7, 3).toString()).toBe(SAMPLE.substr(7, 3));
    expect(vstring.substr(SAMPLE, -5, 2).toString()).toBe(SAMPLE.substr(-5, 2));
  });

  test("charAt / at", () => {
    expect(vstring.charAt(SAMPLE, 0).toString()).toBe(SAMPLE.charAt(0));
    expect(vstring.charAt(SAMPLE, 99).toString()).toBe(SAMPLE.charAt(99));
    expect(vstring.at(SAMPLE, -1).toString()).toBe("d");
  });

  test("trim family matches String#trim*", () => {
    const padded = "  \t hi there \n ";
    expect(vstring.trim(padded).toString()).toBe(padded.trim());
    expect(vstring.trimStart(padded).toString()).toBe(padded.trimStart());
    expect(vstring.trimEnd(padded).toString()).toBe(padded.trimEnd());
  });

  test("a view of a view stays anchored to the original data", () => {
    const w = vstring.slice(SAMPLE, 7); // "world"
    expect(w.toString()).toBe("world");
    expect(w.slice(1, 4).toString()).toBe("orl");
    expect(w.data).toBe(SAMPLE); // backing string is the GC owner
  });
});

describe("vstring queries", () => {
  test("length / isEmpty", () => {
    expect(vstring.length(SAMPLE)).toBe(SAMPLE.length);
    expect(vstring.isEmpty("")).toBe(true);
    expect(vstring.slice(SAMPLE, 3, 3).isEmpty).toBe(true);
  });

  test("charCodeAt / codePointAt", () => {
    expect(vstring.charCodeAt(SAMPLE, 0)).toBe(SAMPLE.charCodeAt(0));
    expect(vstring.codePointAt("a😀b", 1)).toBe(0x1f600);
  });

  test("indexOf / lastIndexOf / includes", () => {
    expect(vstring.indexOf(SAMPLE, "o")).toBe(SAMPLE.indexOf("o"));
    expect(vstring.indexOf(SAMPLE, "o", 6)).toBe(SAMPLE.indexOf("o", 6));
    expect(vstring.indexOf(SAMPLE, "zzz")).toBe(-1);
    expect(vstring.lastIndexOf(SAMPLE, "o")).toBe(SAMPLE.lastIndexOf("o"));
    expect(vstring.includes(SAMPLE, "wor")).toBe(true);
  });

  test("startsWith / endsWith", () => {
    expect(vstring.startsWith(SAMPLE, "hello")).toBe(true);
    expect(vstring.startsWith(SAMPLE, "world", 7)).toBe(true);
    expect(vstring.endsWith(SAMPLE, "world")).toBe(true);
    expect(vstring.endsWith(SAMPLE, "hello", 5)).toBe(true);
  });

  test("startsWith / endsWith edge cases match native", () => {
    const probes: string[] = ["", "hello", "world", "hello, world", "xx"];
    const positions: i32[] = [-3, 0, 3, 5, 12, 99];
    for (let i = 0; i < probes.length; i++) {
      const p = probes[i];
      expect(vstring.startsWith(SAMPLE, p)).toBe(SAMPLE.startsWith(p));
      expect(vstring.endsWith(SAMPLE, p)).toBe(SAMPLE.endsWith(p));
      for (let j = 0; j < positions.length; j++) {
        const n = positions[j];
        expect(vstring.startsWith(SAMPLE, p, n)).toBe(SAMPLE.startsWith(p, n));
        expect(vstring.endsWith(SAMPLE, p, n)).toBe(SAMPLE.endsWith(p, n));
      }
    }
  });

  test("equality and ordering operate on content, not identity", () => {
    const a = vstring.slice(SAMPLE, 7); // "world"
    const b = vstring.slice("xxworld", 2); // "world", different backing string
    expect(a.equals(b)).toBe(true);
    expect(a == b).toBe(true);
    expect(vstring.slice("apple", 0) < vstring.from("banana")).toBe(true);
    expect(a.equalsString("world")).toBe(true);
  });

  test("operators: <= >= [] and the VString alias export", () => {
    // `VString` is exported as a PascalCase alias for the `vstring` class.
    const a: VString = VString.from("alpha");
    const b: vstring = vstring.from("beta");
    expect(a <= b).toBe(true);
    expect(b >= a).toBe(true);
    expect(a <= vstring.from("alpha")).toBe(true);
    expect(a >= vstring.from("alpha")).toBe(true);
    expect(vstring.from("b") >= vstring.from("a")).toBe(true);
    // [] indexes a UTF-16 code unit without allocating
    const v = vstring.from(SAMPLE);
    expect(v[0]).toBe(SAMPLE.charCodeAt(0));
    expect(v[7]).toBe(SAMPLE.charCodeAt(7));
    expect(v[999]).toBe(-1);
    // vstring.* statics are reachable directly too
    expect(vstring.slice(SAMPLE, 7).toString()).toBe("world");
  });
});

describe("vstring namespace accepts string OR vstring", () => {
  test("primary argument may already be a view", () => {
    const v: vstring = vstring.from(SAMPLE);
    expect(vstring.slice(v, 7).toString()).toBe("world");
    expect(vstring.length(v)).toBe(SAMPLE.length);
    expect(vstring.indexOf(v, "world")).toBe(7);
  });
});

describe("allocating helpers match native String", () => {
  test("case / replace defer to native", () => {
    expect(vstring.toUpperCase(SAMPLE)).toBe(SAMPLE.toUpperCase());
    expect(vstring.toLowerCase("HeLLo")).toBe("HeLLo".toLowerCase());
    expect(vstring.replace("a-b-c", "-", "+")).toBe("a+b-c");
    expect(vstring.replaceAll("a-b-c", "-", "+")).toBe("a+b+c");
  });

  test("concat (built directly on the view)", () => {
    expect(vstring.concat("foo", "bar")).toBe("foobar");
    expect(vstring.concat("", "bar")).toBe("bar");
    expect(vstring.concat("foo", "")).toBe("foo");
    // operate on a view, not just a whole string
    expect(vstring.concat(vstring.slice("xxfoo", 2), "bar")).toBe("foobar");
  });

  test("repeat (built directly on the view)", () => {
    expect(vstring.repeat("ab", 3)).toBe("ababab");
    expect(vstring.repeat("ab", 0)).toBe("");
    expect(vstring.repeat("ab", 1)).toBe("ab");
    expect(vstring.repeat(vstring.slice("__xy", 2), 3)).toBe("xyxyxy");
  });

  test("padStart / padEnd match native across pad widths", () => {
    const cases: string[] = ["7", "ab", "hello"];
    const pads: string[] = ["0", ".", "ab", "xyz"];
    const lens: i32[] = [0, 1, 3, 6, 7, 10];
    for (let i = 0; i < cases.length; i++) {
      for (let j = 0; j < pads.length; j++) {
        for (let k = 0; k < lens.length; k++) {
          const s = cases[i];
          const p = pads[j];
          const n = lens[k];
          expect(vstring.padStart(s, n, p)).toBe(s.padStart(n, p));
          expect(vstring.padEnd(s, n, p)).toBe(s.padEnd(n, p));
        }
      }
    }
  });
});

describe("vstring instance methods mirror native String", () => {
  test("materializing instance methods", () => {
    const v = vstring.from(SAMPLE); // "hello, world"
    expect(v.concat("!")).toBe(SAMPLE + "!");
    expect(v.concat(vstring.from("?"))).toBe(SAMPLE + "?");
    expect(vstring.from("ab").repeat(3)).toBe("ababab");
    expect(vstring.from("7").padStart(3, "0")).toBe("007");
    expect(vstring.from("7").padEnd(3, "0")).toBe("700");
    expect(vstring.from("a-b-c").replace("-", "+")).toBe("a+b-c");
    expect(vstring.from("a-b-c").replaceAll("-", "+")).toBe("a+b+c");
    expect(v.toUpperCase()).toBe(SAMPLE.toUpperCase());
    expect(v.toLowerCase()).toBe(SAMPLE.toLowerCase());
  });

  test("trim aliases, localeCompare, + operator, statics", () => {
    expect(vstring.from("  hi  ").trimLeft().toString()).toBe("hi  ");
    expect(vstring.from("  hi  ").trimRight().toString()).toBe("  hi");
    expect(vstring.from("a").localeCompare(vstring.from("b")) < 0).toBe(true);
    expect(vstring.from("a").localeCompare(vstring.from("a"))).toBe(0);
    expect((vstring.from("foo") + vstring.from("bar")).toString()).toBe(
      "foobar",
    );
    expect(vstring.fromCharCode(65).toString()).toBe("A");
    expect(vstring.fromCodePoint(0x1f600).toString()).toBe("😀");
  });

  test("instance split with a limit", () => {
    const parts = vstring.from("a,b,c,d").split(",", 2);
    expect(parts.length).toBe(2);
    expect(parts[1].toString()).toBe("b");
  });
});

describe("vstring.UTF8 / UTF16 (powered by utf-as)", () => {
  test("UTF16 round-trips a view's bytes", () => {
    const backing = "xx héllo, 世界 😀 yy";
    const view = vstring.slice(backing, 2, backing.length - 2);
    const mid = view.toString();
    expect(vstring.UTF16.byteLength(view)).toBe(mid.length << 1);
    const buf = vstring.UTF16.encode(view);
    expect(buf.byteLength).toBe(mid.length << 1);
    expect(vstring.UTF16.decode(buf).equalsString(mid)).toBe(true);
    expect(vstring.UTF16.validate(view)).toBe(true);
  });

  test("UTF8 encodes a view and round-trips", () => {
    const backing = "xx héllo, 世界 😀 yy";
    const view = vstring.slice(backing, 2, backing.length - 2);
    const mid = view.toString();
    const buf = vstring.UTF8.encode(view);
    expect(buf.byteLength).toBe(vstring.UTF8.byteLength(view));
    expect(vstring.UTF8.decode(buf).equalsString(mid)).toBe(true);
  });

  test("MAX_LENGTH matches String.MAX_LENGTH", () => {
    expect(vstring.MAX_LENGTH).toBe(String.MAX_LENGTH);
  });
});

describe("split returns zero-copy pieces", () => {
  test("splits on a separator", () => {
    const parts = vstring.split("a,bb,ccc", ",");
    expect(parts.length).toBe(3);
    expect(parts[0].toString()).toBe("a");
    expect(parts[1].toString()).toBe("bb");
    expect(parts[2].toString()).toBe("ccc");
  });

  test("empty separator yields each code unit", () => {
    const parts = vstring.split("abc", "");
    expect(parts.length).toBe(3);
    expect(parts[2].toString()).toBe("c");
  });
});
