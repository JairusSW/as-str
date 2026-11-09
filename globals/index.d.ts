// @ts-ignore: only resolves when library
import { Str as _Str, str as _str } from "as-str/assembly/index";

/* eslint-disable @typescript-eslint/no-empty-object-type -- ambient interfaces merge the imported class type with global namespaces. */

export {};

declare global {
  /** Zero-copy virtual string view (UTF-16). The type used in annotations. */
  interface str extends _Str {}
  /** The `str` value: callable as a converter (`str(x)`) AND the static
   *  free-function / encoding API (`str.from`, `str.slice`, `str.UTF8`, …). */
  const str: typeof _str & typeof _Str;

  /** Uppercase class type injected by global mode. */
  interface Str extends _Str {}
  /** Uppercase class value and static API injected by global mode. */
  const Str: typeof _Str;

  namespace str {
    namespace UTF8 {
      type ErrorMode = _str.UTF8.ErrorMode;
    }
  }

  namespace Str {
    namespace UTF8 {
      type ErrorMode = _Str.UTF8.ErrorMode;
    }
  }
}
