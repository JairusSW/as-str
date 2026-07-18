// Behavioral tests for the virtual string core. The native `String` methods
// are the oracle: a `str` view, once materialized, must agree with what the
// equivalent native operation produces.

import { describe, test, expect } from "as-test";
import { str, str8 } from "../index";

const SAMPLE = "hello, world";

describe("str views (zero-copy)", () => {
  test("slice matches String#slice", () => {
    expect(str.slice(SAMPLE, 2).toString()).toBe(SAMPLE.slice(2));
    expect(str.slice(SAMPLE, 0, 5).toString()).toBe(SAMPLE.slice(0, 5));
    expect(str.slice(SAMPLE, -5).toString()).toBe(SAMPLE.slice(-5));
    expect(str.slice(SAMPLE, -5, -1).toString()).toBe(SAMPLE.slice(-5, -1));
    expect(str.slice(SAMPLE, 8, 2).toString()).toBe(SAMPLE.slice(8, 2));
  });

  test("substring matches String#substring", () => {
    expect(str.substring(SAMPLE, 7).toString()).toBe(SAMPLE.substring(7));
    expect(str.substring(SAMPLE, 7, 2).toString()).toBe(SAMPLE.substring(7, 2));
    expect(str.substring(SAMPLE, -3, 4).toString()).toBe(
      SAMPLE.substring(-3, 4),
    );
  });

  test("substr matches String#substr", () => {
    expect(str.substr(SAMPLE, 7, 3).toString()).toBe(SAMPLE.substr(7, 3));
    expect(str.substr(SAMPLE, -5, 2).toString()).toBe(SAMPLE.substr(-5, 2));
  });

  test("charAt / at", () => {
    expect(str.charAt(SAMPLE, 0).toString()).toBe(SAMPLE.charAt(0));
    expect(str.charAt(SAMPLE, 99).toString()).toBe(SAMPLE.charAt(99));
    expect(str.at(SAMPLE, -1).toString()).toBe("d");
  });

  test("trim family matches String#trim*", () => {
    const padded = "  \t hi there \n ";
    expect(str.trim(padded).toString()).toBe(padded.trim());
    expect(str.trimStart(padded).toString()).toBe(padded.trimStart());
    expect(str.trimEnd(padded).toString()).toBe(padded.trimEnd());
  });

  test("a view of a view stays anchored to the original data", () => {
    const w = str.slice(SAMPLE, 7); // "world"
    expect(w.toString()).toBe("world");
    expect(w.slice(1, 4).toString()).toBe("orl");
    expect(w.data).toBe(SAMPLE); // backing string is the GC owner
  });
});

describe("str queries", () => {
  test("length / isEmpty", () => {
    expect(str.length(SAMPLE)).toBe(SAMPLE.length);
    expect(str.isEmpty("")).toBe(true);
    expect(str.slice(SAMPLE, 3, 3).isEmpty).toBe(true);
  });

  test("allocation-free view length specializations match produced views", () => {
    const padded = "  abc/def=ghi[jkl]<mno>  ";
    expect(str.sliceLength(padded, -8, -1)).toBe(
      str.slice(padded, -8, -1).length,
    );
    expect(str.substringLength(padded, 9, 2)).toBe(
      str.substring(padded, 9, 2).length,
    );
    expect(str.substrLength(padded, -8, 4)).toBe(
      str.substr(padded, -8, 4).length,
    );
    expect(str.charAtLength(padded, 2)).toBe(str.charAt(padded, 2).length);
    expect(str.charAtLength(padded, 999)).toBe(str.charAt(padded, 999).length);
    expect(str.atLength(padded, -1)).toBe(str.at(padded, -1).length);
    expect(str.trimLength(padded)).toBe(str.trim(padded).length);
    expect(str.trimStartLength(padded)).toBe(str.trimStart(padded).length);
    expect(str.trimEndLength(padded)).toBe(str.trimEnd(padded).length);
    expect(str.trimLeftLength(padded)).toBe(str.from(padded).trimLeft().length);
    expect(str.trimRightLength(padded)).toBe(
      str.from(padded).trimRight().length,
    );
    expect(str.beforeLength(padded, "=")).toBe(str.before(padded, "=").length);
    expect(str.afterLength(padded, "=")).toBe(str.after(padded, "=").length);
    expect(str.betweenLength(padded, "[", "]")).toBe(
      str.between(padded, "[", "]").length,
    );
    expect(str.beforeLastLength(padded, "/")).toBe(
      str.beforeLast(padded, "/").length,
    );
    expect(str.afterLastLength(padded, "/")).toBe(
      str.afterLast(padded, "/").length,
    );
    expect(str.betweenLastLength(padded, "<", ">")).toBe(
      str.betweenLast(padded, "<", ">").length,
    );
    expect(str.afterLength(padded, "missing")).toBe(0);
    expect(str.betweenLastLength("abc", "[", "]")).toBe(0);

    const view = str.slice(padded, 2, -2);
    expect(str.trimLength(view)).toBe(view.trim().length);
    expect(str.sliceLength(view, 1, -1)).toBe(view.slice(1, -1).length);
  });

  test("charCodeAt / codePointAt", () => {
    expect(str.charCodeAt(SAMPLE, 0)).toBe(SAMPLE.charCodeAt(0));
    expect(str.codePointAt("a😀b", 1)).toBe(0x1f600);
  });

  test("indexOf / lastIndexOf / includes", () => {
    expect(str.indexOf(SAMPLE, "o")).toBe(SAMPLE.indexOf("o"));
    expect(str.indexOf(SAMPLE, "o", 6)).toBe(SAMPLE.indexOf("o", 6));
    expect(str.indexOf(SAMPLE, "zzz")).toBe(-1);
    expect(str.lastIndexOf(SAMPLE, "o")).toBe(SAMPLE.lastIndexOf("o"));
    expect(str.includes(SAMPLE, "wor")).toBe(true);
  });

  test("before / after / between helpers", () => {
    const route = str.from("GET /api/users?id=42 HTTP/1.1");
    expect(route.before(" ").toString()).toBe("GET");
    expect(route.after(" ").before(" ").toString()).toBe("/api/users?id=42");
    expect(route.between("/api/", "?").toString()).toBe("users");
    expect(str.before("abc", "x").toString()).toBe("");
    expect(str.after("abc", "x").toString()).toBe("");
    expect(str.between("abc", "[", "]").toString()).toBe("");
  });

  test("beforeLast / afterLast / betweenLast helpers", () => {
    const path = str.from("/root/app/src/index.ts");
    expect(path.beforeLast("/").toString()).toBe("/root/app/src");
    expect(path.afterLast("/").toString()).toBe("index.ts");
    expect(str.betweenLast("a[b] c[d]", "[", "]").toString()).toBe("d");
    expect(str.beforeLast("abc", "x").toString()).toBe("");
    expect(str.afterLast("abc", "x").toString()).toBe("");
    expect(str.betweenLast("abc", "[", "]").toString()).toBe("");
  });

  test("startsWith / endsWith", () => {
    expect(str.startsWith(SAMPLE, "hello")).toBe(true);
    expect(str.startsWith(SAMPLE, "world", 7)).toBe(true);
    expect(str.endsWith(SAMPLE, "world")).toBe(true);
    expect(str.endsWith(SAMPLE, "hello", 5)).toBe(true);
  });

  test("startsWith / endsWith edge cases match native", () => {
    const probes: string[] = ["", "hello", "world", "hello, world", "xx"];
    const positions: i32[] = [-3, 0, 3, 5, 12, 99];
    for (let i = 0; i < probes.length; i++) {
      const p = probes[i];
      expect(str.startsWith(SAMPLE, p)).toBe(SAMPLE.startsWith(p));
      expect(str.endsWith(SAMPLE, p)).toBe(SAMPLE.endsWith(p));
      for (let j = 0; j < positions.length; j++) {
        const n = positions[j];
        expect(str.startsWith(SAMPLE, p, n)).toBe(SAMPLE.startsWith(p, n));
        expect(str.endsWith(SAMPLE, p, n)).toBe(SAMPLE.endsWith(p, n));
      }
    }
  });

  test("equality and ordering operate on content, not identity", () => {
    const a = str.slice(SAMPLE, 7); // "world"
    const b = str.slice("xxworld", 2); // "world", different backing string
    expect(a.equals(b)).toBe(true);
    expect(a == b).toBe(true);
    expect(str.slice("apple", 0) < str.from("banana")).toBe(true);
    expect(a.equalsString("world")).toBe(true);
  });

  test("operators: <= >= []", () => {
    const a: str = str.from("alpha");
    const b: str = str.from("beta");
    expect(a <= b).toBe(true);
    expect(b >= a).toBe(true);
    expect(a <= str.from("alpha")).toBe(true);
    expect(a >= str.from("alpha")).toBe(true);
    expect(str.from("b") >= str.from("a")).toBe(true);
    // [] indexes a UTF-16 code unit without allocating
    const v = str.from(SAMPLE);
    expect(v[0]).toBe(SAMPLE.charCodeAt(0));
    expect(v[7]).toBe(SAMPLE.charCodeAt(7));
    expect(v[999]).toBe(-1);
    // str.* statics are reachable directly too
    expect(str.slice(SAMPLE, 7).toString()).toBe("world");
  });
});

describe("str namespace accepts string OR str", () => {
  test("primary argument may already be a view", () => {
    const v: str = str.from(SAMPLE);
    expect(str.slice(v, 7).toString()).toBe("world");
    expect(str.length(v)).toBe(SAMPLE.length);
    expect(str.indexOf(v, "world")).toBe(7);
  });
});

describe("allocating helpers match native String", () => {
  test("case / replace defer to native", () => {
    expect(str.toUpperCase(SAMPLE)).toBe(SAMPLE.toUpperCase());
    expect(str.toLowerCase("HeLLo")).toBe("HeLLo".toLowerCase());
    expect(str.replace("a-b-c", "-", "+")).toBe("a+b-c");
    expect(str.replaceAll("a-b-c", "-", "+")).toBe("a+b+c");
  });

  test("case folding: ASCII fast path tiers + non-ASCII native fallback", () => {
    // long ASCII -> SIMD (8 units) + SWAR (4 units) + scalar fold tiers
    const LONG = "The Quick Brown FOX 0123!@# over THE lazy Dog and Cat.";
    expect(str.toUpperCase(LONG)).toBe(LONG.toUpperCase());
    expect(str.toLowerCase(LONG)).toBe(LONG.toLowerCase());
    expect(str.from(LONG).toUpperCase()).toBe(LONG.toUpperCase());
    // non-ASCII -> defers to native Unicode-aware fold
    const U = "héllo, 世界 ﬁ ß";
    expect(str.toUpperCase(U)).toBe(U.toUpperCase());
    expect(str.toLowerCase("HÉLLO, 世界")).toBe("HÉLLO, 世界".toLowerCase());
    // a slice that is ASCII even though its backing string is not
    expect(str.slice(U, 0, 1).toUpperCase()).toBe("H");
  });

  test("concat (built directly on the view)", () => {
    expect(str.concat("foo", "bar")).toBe("foobar");
    expect(str.concat("", "bar")).toBe("bar");
    expect(str.concat("foo", "")).toBe("foo");
    // operate on a view, not just a whole string
    expect(str.concat(str.slice("xxfoo", 2), "bar")).toBe("foobar");
  });

  test("repeat (built directly on the view)", () => {
    expect(str.repeat("ab", 3)).toBe("ababab");
    expect(str.repeat("ab", 0)).toBe("");
    expect(str.repeat("ab", 1)).toBe("ab");
    expect(str.repeat(str.slice("__xy", 2), 3)).toBe("xyxyxy");
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
          expect(str.padStart(s, n, p)).toBe(s.padStart(n, p));
          expect(str.padEnd(s, n, p)).toBe(s.padEnd(n, p));
        }
      }
    }
  });
});

describe("str instance methods mirror native String", () => {
  test("materializing instance methods", () => {
    const v = str.from(SAMPLE); // "hello, world"
    expect(v.concat("!")).toBe(SAMPLE + "!");
    expect(v.concat(str.from("?"))).toBe(SAMPLE + "?");
    expect(str.from("ab").repeat(3)).toBe("ababab");
    expect(str.from("7").padStart(3, "0")).toBe("007");
    expect(str.from("7").padEnd(3, "0")).toBe("700");
    expect(str.from("a-b-c").replace("-", "+")).toBe("a+b-c");
    expect(str.from("a-b-c").replaceAll("-", "+")).toBe("a+b+c");
    expect(v.toUpperCase()).toBe(SAMPLE.toUpperCase());
    expect(v.toLowerCase()).toBe(SAMPLE.toLowerCase());
  });

  test("trim aliases, localeCompare, + operator, statics", () => {
    expect(str.from("  hi  ").trimLeft().toString()).toBe("hi  ");
    expect(str.from("  hi  ").trimRight().toString()).toBe("  hi");
    expect(str.from("a").localeCompare(str.from("b")) < 0).toBe(true);
    expect(str.from("a").localeCompare(str.from("a"))).toBe(0);
    expect((str.from("foo") + str.from("bar")).toString()).toBe("foobar");
    expect(str.fromCharCode(65).toString()).toBe("A");
    expect(str.fromCodePoint(0x1f600).toString()).toBe("😀");
  });

  test("instance split with a limit", () => {
    const parts = str.from("a,b,c,d").split(",", 2);
    expect(parts.length).toBe(2);
    expect(parts[1].toString()).toBe("b");
  });
});

describe("str.UTF8 / UTF16 (powered by utf-as)", () => {
  test("UTF16 round-trips a view's bytes", () => {
    const backing = "xx héllo, 世界 😀 yy";
    const view = str.slice(backing, 2, backing.length - 2);
    const mid = view.toString();
    expect(str.UTF16.byteLength(view)).toBe(mid.length << 1);
    const buf = str.UTF16.encode(view);
    expect(buf.byteLength).toBe(mid.length << 1);
    expect(str.UTF16.decode(buf).equalsString(mid)).toBe(true);
    expect(str.UTF16.validate(view)).toBe(true);
  });

  test("UTF8 encodes a view and round-trips", () => {
    const backing = "xx héllo, 世界 😀 yy";
    const view = str.slice(backing, 2, backing.length - 2);
    const mid = view.toString();
    const buf = str.UTF8.encode(view);
    expect(buf.byteLength).toBe(str.UTF8.byteLength(view));
    expect(str.UTF8.decode(buf).equalsString(mid)).toBe(true);
  });

  test("MAX_LENGTH matches String.MAX_LENGTH", () => {
    // @ts-expect-error: String.MAX_LENGTH exists in asc (editor sees JS String)
    expect(str.MAX_LENGTH).toBe(String.MAX_LENGTH);
  });
});

describe("split returns zero-copy pieces", () => {
  test("splits on a separator", () => {
    const parts = str.split("a,bb,ccc", ",");
    expect(parts.length).toBe(3);
    expect(parts[0].toString()).toBe("a");
    expect(parts[1].toString()).toBe("bb");
    expect(parts[2].toString()).toBe("ccc");
  });

  test("empty separator yields each code unit", () => {
    const parts = str.split("abc", "");
    expect(parts.length).toBe(3);
    expect(parts[2].toString()).toBe("c");
  });
});

describe("str() converter and cross-conversion", () => {
  test("str(x) converts any value via toString", () => {
    expect(str(SAMPLE).toString()).toBe(SAMPLE); // string -> str
    expect(str<i32>(42).toString()).toBe((42).toString()); // number
    expect(str<f64>(3.5).toString()).toBe((<f64>3.5).toString());
    expect(str(str.from("abc")).toString()).toBe("abc"); // str identity
    expect(str(str8.from("héllo")).toString()).toBe("héllo"); // str8 -> str
  });

  test(".toStr (identity) / .toStr8 (bridge to UTF-8)", () => {
    const v = str.from("héllo");
    expect(v.toStr().toString()).toBe("héllo"); // identity
    const u = v.toStr8(); // str -> str8 (UTF-8)
    expect(u.toString()).toBe("héllo");
    expect(u.byteLength).toBe(6); // 'é' is 2 UTF-8 bytes
  });

  test("full-range toString returns the backing string", () => {
    const backing = "allocation-free round trip";
    const native = str.from(backing).toString();
    expect(changetype<usize>(native)).toBe(changetype<usize>(backing));
    expect(str.slice(backing, 1).toString()).toBe("llocation-free round trip");
  });

  test("str is usable as a type annotation", () => {
    const a: str = str(SAMPLE);
    expect(a.length).toBe(SAMPLE.length);
  });
});
