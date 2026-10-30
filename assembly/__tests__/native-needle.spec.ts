import { describe, expect, test } from "as-test";
import { str8 } from "../index";

describe("UTF-8 queries with native string needles", () => {
  test("short ASCII searches cover packed comparisons and the repeated-prefix fallback", () => {
    let seed: u32 = 0x5eed1234;
    for (let length = 2; length <= 35; length++) {
      const units = new Array<i32>(length);
      for (let i = 0; i < length; i++) {
        seed = seed * 1664525 + 1013904223;
        units[i] = <i32>(seed % 95) + 32;
      }
      const needle = String.fromCharCodes(units);
      const first = needle.slice(0, 1);
      const cases = [
        first.repeat(80),
        first.repeat(80) + needle,
        needle + first.repeat(80),
        "<" + needle + ">" + needle + "<",
      ];
      for (let t = 0; t < cases.length; t++) {
        const text = cases[t];
        const view = str8.from("[" + text + "]").slice(1, -1);
        for (let from = -1; from <= text.length + 1; from++) {
          expect(view.indexOf(needle, from)).toBe(text.indexOf(needle, from));
          expect(view.lastIndexOf(needle, from)).toBe(
            text.lastIndexOf(needle, from),
          );
        }
      }
    }
  });

  test("match prepared UTF-8 needles for ASCII, Unicode, and WTF-8", () => {
    const inputs = [
      "",
      "a",
      "abc",
      "Content-Type: application/json",
      "abcé😀日本語abc",
      "\0a\0b\0",
      "\ud800abc\udc00",
      "a".repeat(65) + "z",
    ];
    const needles = [
      "",
      "a",
      "b",
      "z",
      "abc",
      "abcd",
      "Content-Type",
      "application/json",
      "é",
      "😀",
      "日本語",
      "abcé",
      "éabc",
      "\0",
      "a\0b",
      "\ud800",
      "\udc00",
      "a".repeat(64),
      "a".repeat(66),
    ];
    const positions = [
      i32.MIN_VALUE,
      -1,
      0,
      1,
      2,
      7,
      16,
      31,
      63,
      65,
      100,
      i32.MAX_VALUE,
    ];
    for (let i = 0; i < inputs.length; i++) {
      const view = str8.from("<" + inputs[i] + ">").slice(1, -1);
      for (let n = 0; n < needles.length; n++) {
        const needle = needles[n];
        const prepared = str8.from(needle);
        expect(view.equalsString(needle)).toBe(view.equals(prepared));
        expect(str8.equals(view, needle)).toBe(view.equals(prepared));
        expect(view.includes(needle)).toBe(view.includes(prepared));
        expect(view.before(needle).toString()).toBe(
          view.before(prepared).toString(),
        );
        expect(view.after(needle).toString()).toBe(
          view.after(prepared).toString(),
        );
        expect(view.beforeLast(needle).toString()).toBe(
          view.beforeLast(prepared).toString(),
        );
        expect(view.afterLast(needle).toString()).toBe(
          view.afterLast(prepared).toString(),
        );
        expect(str8.before(view, needle).toString()).toBe(
          view.before(prepared).toString(),
        );
        expect(str8.after(view, needle).toString()).toBe(
          view.after(prepared).toString(),
        );
        expect(str8.beforeLast(view, needle).toString()).toBe(
          view.beforeLast(prepared).toString(),
        );
        expect(str8.afterLast(view, needle).toString()).toBe(
          view.afterLast(prepared).toString(),
        );
        const close = str8.from("abc");
        expect(view.between(needle, "abc").toString()).toBe(
          view.between(prepared, close).toString(),
        );
        expect(view.betweenLast(needle, "abc").toString()).toBe(
          view.betweenLast(prepared, close).toString(),
        );
        expect(str8.between(view, needle, "abc").toString()).toBe(
          view.between(prepared, close).toString(),
        );
        expect(str8.betweenLast(view, needle, "abc").toString()).toBe(
          view.betweenLast(prepared, close).toString(),
        );
        for (let p = 0; p < positions.length; p++) {
          const at = positions[p];
          expect(view.indexOf(needle, at)).toBe(view.indexOf(prepared, at));
          expect(view.lastIndexOf(needle, at)).toBe(
            view.lastIndexOf(prepared, at),
          );
          expect(view.startsWith(needle, at)).toBe(
            view.startsWith(prepared, at),
          );
          expect(view.endsWith(needle, at)).toBe(view.endsWith(prepared, at));
          expect(str8.indexOf(view, needle, at)).toBe(
            view.indexOf(prepared, at),
          );
          expect(str8.lastIndexOf(view, needle, at)).toBe(
            view.lastIndexOf(prepared, at),
          );
          expect(str8.startsWith(view, needle, at)).toBe(
            view.startsWith(prepared, at),
          );
          expect(str8.endsWith(view, needle, at)).toBe(
            view.endsWith(prepared, at),
          );
        }
      }
    }
  });
});
