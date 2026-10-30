import { describe, expect, test } from "as-test";
import { str8 } from "../index";

describe("encoding-free UTF-8 metadata queries", () => {
  test("native strings and byte inputs agree on arbitrary UTF-16 and WTF-8", () => {
    let seed: u32 = 0x50524f50;
    const boundaries = [
      0, 0x7f, 0x80, 0x7ff, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000,
      0xffff,
    ];
    for (let sample = 0; sample < 2000; sample++) {
      const units = new Array<i32>(sample % 130);
      let ascii = true;
      for (let i = 0; i < units.length; i++) {
        seed = seed * 1664525 + 1013904223;
        const unit =
          sample % 3 == 0
            ? <i32>(seed & 0x7f)
            : sample % 3 == 1
              ? boundaries[seed % boundaries.length]
              : <i32>(seed >> 16);
        units[i] = unit;
        if (unit >= 0x80) ascii = false;
      }
      const text = String.fromCharCodes(units);
      let points = 0;
      for (let i = 0; i < text.length; points++) {
        i += text.codePointAt(i) >= 0x10000 ? 2 : 1;
      }
      const bytes = str8.from(text);
      const offset = str8.from("<" + text + ">").slice(1, -1);
      expect(str8.codePointCount(text)).toBe(points);
      expect(str8.codePointCount(bytes.buffer)).toBe(points);
      expect(str8.codePointCount(offset)).toBe(points);
      expect(bytes.codePointCount()).toBe(points);
      expect(str8.isAscii(text)).toBe(ascii);
      expect(str8.isAscii(bytes.buffer)).toBe(ascii);
      expect(str8.isAscii(offset)).toBe(ascii);
    }
  });
});
