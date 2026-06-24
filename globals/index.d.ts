// Editor-only ambient typings for as-str's global mode. They let the TS
// language server resolve `str` with no explicit import; the `as-str` transform
// (`--transform as-str/transform`) injects the real runtime import at compile
// time.
//
// Loaded via the `as-str/globals.json` preset (add it to your assembly
// tsconfig's `extends` array). asc never loads this file, so there is no
// duplicate-identifier conflict with the injected import.
import { str as _str } from "as-str/assembly/index";

export {};

declare global {
  /** Zero-copy virtual string view: the type, the instance methods, and the
   *  static free-function API (`str.slice`, …). */
  type str = _str;
  const str: typeof _str;
}
