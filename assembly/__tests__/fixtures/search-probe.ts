import { str8 } from "../../index";

function query<U>(
  hay: str8,
  needle: U,
  from: i32,
  operation: i32,
  free: bool,
): i32 {
  if (free) {
    switch (operation) {
      case 0:
        return str8.indexOf(hay, needle, from);
      case 1:
        return str8.lastIndexOf(hay, needle, from);
      case 2:
        return i32(str8.startsWith(hay, needle, from));
      case 3:
        return i32(str8.endsWith(hay, needle, from));
      default:
        return i32(str8.equals(hay, needle));
    }
  }
  switch (operation) {
    case 0:
      return hay.indexOf(needle, from);
    case 1:
      return hay.lastIndexOf(needle, from);
    case 2:
      return i32(hay.startsWith(needle, from));
    case 3:
      return i32(hay.endsWith(needle, from));
    default:
      if (isString<U>())
        return i32(hay.equalsString(changetype<string>(needle)));
      if (idof<U>() == idof<ArrayBuffer>())
        return i32(
          hay.equals(str8.fromBuffer(changetype<ArrayBuffer>(needle))),
        );
      return i32(hay.equals(changetype<str8>(needle)));
  }
}

export function search(
  hay: ArrayBuffer,
  text: string,
  needle: ArrayBuffer,
  from: i32,
  operation: i32,
  variant: i32,
  free: bool,
): i32 {
  const view = str8.fromBuffer(hay).slice(3, -5);
  if (variant == 0) return query(view, text, from, operation, free);
  if (variant == 1) {
    const needleView = str8.fromBuffer(needle).slice(3, -5);
    return query(view, needleView, from, operation, free);
  }
  return query(
    view,
    needle.slice(3, needle.byteLength - 5),
    from,
    operation,
    free,
  );
}

export function nativeCompare(left: string, right: string): i32 {
  return str8.compare(left, right);
}
