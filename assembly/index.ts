/**
 * Package entry point for `as-str` - virtual (zero-copy) strings for
 * AssemblyScript. `str` (UTF-16, `string`-backed) and `str8` (UTF-8,
 * `ArrayBuffer`-backed) are each both the type and the API surface.
 */
export { Str, str } from "./str";
export { Str8, str8 } from "./str8";

// Transform-only aliases keep generated scalar annotations independent of
// application declarations named after AssemblyScript primitive types.
export type __as_str_i32 = i32;
export type __as_str_u64 = u64;
export type __as_str_string = string;
