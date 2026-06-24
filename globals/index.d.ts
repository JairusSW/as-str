// Editor-only ambient typings for str-as's global mode. They let the TS
// language server resolve `str` with no explicit import; the `str-as` transform
// (`--transform str-as/transform`) injects the real runtime import at compile
// time.
//
// Loaded via the `str-as/globals.json` preset (add it to your assembly
// tsconfig's `extends` array). asc never loads this file, so there is no
// duplicate-identifier conflict with the injected import.
import { str as _str } from "str-as/assembly/index";

export {};

declare global {
  /** Zero-copy virtual string view: the type, the instance methods, and the
   *  static free-function API (`str.slice`, …). */
  type str = _str;
  const str: typeof _str;
}
