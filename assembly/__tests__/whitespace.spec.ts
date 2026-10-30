import { describe, expect, test } from "as-test";
import { str, str8 } from "../index";
import { isWhiteSpace } from "../util";

describe("UTF-16 whitespace", () => {
  test("matches native trimming for every code unit", () => {
    for (let code = 0; code <= 0xffff; code++) {
      const text = String.fromCharCode(code);
      expect(isWhiteSpace(<u16>code)).toBe(text.trim().length == 0);
    }
  });

  test("trims partial views without consuming their neighbors", () => {
    const codes = [
      0, 8, 9, 10, 11, 12, 13, 14, 31, 32, 33, 0x7f, 0x80, 0x84, 0x85, 0x86,
      0x9f, 0xa0, 0xa1, 0x1680, 0x180e, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
      0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x200b, 0x2028, 0x2029,
      0x202f, 0x205f, 0x3000, 0xd800, 0xdc00, 0xfeff, 0xffff,
    ];
    for (let i = 0; i < codes.length; i++) {
      const unit = String.fromCharCode(codes[i]);
      const text = unit + "x" + unit;
      const view = str.from("[" + text + "]").slice(1, -1);
      expect(view.trim().toString()).toBe(text.trim());
      expect(view.trimStart().toString()).toBe(text.trimStart());
      expect(view.trimEnd().toString()).toBe(text.trimEnd());
      const bytes = str8.from("[" + text + "]").slice(1, -1);
      expect(bytes.trim().toString()).toBe(text.trim());
      expect(bytes.trimStart().toString()).toBe(text.trimStart());
      expect(bytes.trimEnd().toString()).toBe(text.trimEnd());
    }
  });
});
