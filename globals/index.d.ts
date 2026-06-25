// Editor-only ambient typings for as-str's global mode. They let the TS
// language server resolve `str` with no explicit import; the `as-str` transform
// (`--transform as-str/transform`) injects the real runtime import at compile
// time.
//
// Loaded via the `as-str/globals.json` preset (add it to your assembly
// tsconfig's `extends` array). asc never loads this file, so there is no
// duplicate-identifier conflict with the injected import.
import { Str as _Str, str as _str } from "as-str/assembly/index";

export {};

declare global {
  /** Zero-copy virtual string view (UTF-16). The type used in annotations. */
  type str = _Str;
  /** The `str` value: callable as a converter (`str(x)`) AND the static
   *  free-function / encoding API (`str.from`, `str.slice`, `str.UTF8`, …). */
  const str: typeof _str & typeof _Str;
}
