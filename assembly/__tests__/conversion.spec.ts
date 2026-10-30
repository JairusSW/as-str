import { describe, expect, test } from "as-test";
import { str, str8 } from "../index";

describe("view encoding", () => {
  test("encodes offset UTF-16 views directly, including NUL and lone surrogates", () => {
    const texts = [
      "",
      "content-type",
      "café",
      "日本語😀",
      "\0a\0",
      "\ud800x",
      "\udc00",
      "\ud800\udc00",
      "Résumé 😀 ".repeat(80),
    ];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const view = str.from("<" + text + ">").slice(1, -1);
      const expected = str8.from(text);
      expect(str8.length(text)).toBe(expected.length);
      expect(str8.byteLength(text)).toBe(expected.length);
      expect(str8.UTF8.byteLength(text)).toBe(expected.length);
      expect(str8.UTF16.byteLength(text)).toBe(text.length << 1);
      expect(str8.isEmpty(text)).toBe(text.length == 0);
      expect(str8.length(expected.buffer)).toBe(expected.length);
      expect(str8.byteLength(expected.buffer)).toBe(expected.length);
      expect(str8.UTF8.byteLength(expected.buffer)).toBe(expected.length);
      expect(str8.isEmpty(expected.buffer)).toBe(text.length == 0);
      const encoded8 = str8.UTF8.encode(text);
      expect(str8.fromBuffer(encoded8).equals(expected)).toBe(true);
      const encoded16 = str8.UTF16.encode(text);
      expect(encoded16.byteLength).toBe(text.length << 1);
      for (let unit = 0; unit < text.length; unit++) {
        expect(
          <i32>load<u16>(changetype<usize>(encoded16) + ((<usize>unit) << 1)),
        ).toBe(text.charCodeAt(unit));
      }
      const methods = [view.toStr8(), str8.fromStr(view), str8(view)];
      for (let m = 0; m < methods.length; m++) {
        expect(methods[m].equals(expected)).toBe(true);
        expect(methods[m].length).toBe(expected.length);
        expect(
          changetype<usize>(methods[m].buffer) ==
            changetype<usize>(expected.buffer),
        ).toBe(false);
      }
      expect(view.toString()).toBe(text);
    }
  });

  test("does not combine a surrogate with a unit outside the view", () => {
    const owner = str.from("x😀y");
    for (let lo = 0; lo <= owner.length; lo++) {
      for (let hi = lo; hi <= owner.length; hi++) {
        const view = owner.slice(lo, hi);
        const expected = str8.from(view.toString());
        expect(view.toStr8().equals(expected)).toBe(true);
        expect(str8.fromStr(view).equals(expected)).toBe(true);
        expect(str8(view).equals(expected)).toBe(true);
      }
    }
  });
});
