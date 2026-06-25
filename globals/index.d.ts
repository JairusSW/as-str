// @ts-ignore: only resolves when library
import { Str as _Str, str as _str } from "as-str/assembly/index";

export {};

declare global {
  /** Zero-copy virtual string view (UTF-16). The type used in annotations. */
  type str = _Str;
  /** The `str` value: callable as a converter (`str(x)`) AND the static
   *  free-function / encoding API (`str.from`, `str.slice`, `str.UTF8`, …). */
  const str: typeof _str & typeof _Str;
}
