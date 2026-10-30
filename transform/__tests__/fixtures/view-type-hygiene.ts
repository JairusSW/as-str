const __as_str_view_type_0 = 7;
function shadowed<str, Str, __as_str_view_type>(input: string): i32 {
  // @as-str prefer-view
  const part = input;
  return (
    part.length +
    part.charCodeAt(0) +
    sizeof<str>() +
    sizeof<Str>() +
    sizeof<__as_str_view_type>() +
    __as_str_view_type_0
  );
}
function ordinary(input: string): i32 {
  // @as-str prefer-view
  const part = input;
  return part.length + part.charCodeAt(0);
}
export function genericViewTypeShadow(): i32 {
  return shadowed<i32, i64, i32>("abcdef");
}
export function unshadowedPromotion(): i32 {
  return ordinary("abcdef");
}
export function explicitViewOutsideShadow(): i32 {
  return str.from("abc").length;
}
