import { str, str8 } from "../../index";

const header = str8.from("content-type: application/json; charset=utf-8");
const key = str8.from("content-type");
const sliced = str.from("prefix content-type suffix").slice(7, 19);
const message = "Résumé 日本語 😀";

export function nativeMetadata(): i32 {
  return (
    str8.length(message) +
    str8.byteLength(message) +
    str8.UTF8.byteLength(message) +
    str8.UTF16.byteLength(message) +
    (str8.isEmpty(message) ? 1 : 0)
  );
}

export function nativeEncode8(): i32 {
  return str8.UTF8.encode(message).byteLength;
}

export function nativeEncode16(): i32 {
  return str8.UTF16.encode(message).byteLength;
}

export function toStr8View(): i32 {
  return sliced.toStr8().length;
}
export function fromStrView(): i32 {
  return str8.fromStr(sliced).length;
}
export function convertStrView(): i32 {
  return str8(sliced).length;
}

export function asciiQueries(): bool {
  return (
    header.startsWith("content-type:") &&
    header.endsWith("utf-8") &&
    key.equalsString("content-type") &&
    !key.equalsString("content-length") &&
    header.indexOf(":") == 12 &&
    header.lastIndexOf(";") == 30 &&
    header.includes("/") &&
    str8.indexOf(header, ":") == 12 &&
    str8.lastIndexOf(header, ";") == 30 &&
    str8.startsWith(header, "content-type:") &&
    str8.endsWith(header, "utf-8") &&
    str8.equals(key, "content-type") &&
    str8.equals("content-type", key)
  );
}

export function nativeProperties(): i32 {
  return (str8.isAscii(message) ? 100 : 0) + str8.codePointCount(message);
}

export function bufferProperties(): i32 {
  return (str8.isAscii(key.buffer) ? 100 : 0) + str8.codePointCount(key.buffer);
}

export function nativeOrdering(): i32 {
  return str8.compare("Résumé 日本語 😀", "Résumé 日本語 🌍");
}
