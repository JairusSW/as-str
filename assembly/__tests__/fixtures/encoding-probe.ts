import { UTF8 as U8 } from "utf-as";
import { str, str8 } from "../../index";
export function encode(text: string): ArrayBuffer {
  return str8.from(text).buffer;
}
export function count(text: string): i32 {
  return str8.codePointCount(text);
}

export function encodeNative(text: string): ArrayBuffer {
  return str8.UTF8.encode(text);
}
export function encodeView(text: string): ArrayBuffer {
  return str.UTF8.encode(str.from("[" + text + "]").slice(1, -1));
}
export function encodedLength(text: string): i32 {
  return str8.byteLength(text);
}
export function encodedViewLength(text: string): i32 {
  return str.UTF8.byteLength(str.from("[" + text + "]").slice(1, -1));
}

export function decode(text: string): string {
  return str8.from(text).toString();
}
export function decodeView(text: string): string {
  return str8
    .from("[" + text + "]")
    .slice(1, -1)
    .toString();
}
export function toUtf16(text: string): ArrayBuffer {
  return str8.UTF16.encode(str8.from(text));
}

export function encodeTerminated(text: string): ArrayBuffer {
  return str.UTF8.encode(str.from("[" + text + "]").slice(1, -1), true);
}
export function terminatedLength(text: string): i32 {
  return str.UTF8.byteLength(text, true);
}

export function encodeReplacement(text: string): ArrayBuffer {
  return str.UTF8.encode(text, false, U8.ErrorMode.REPLACE);
}
export function encodeStrict(text: string): ArrayBuffer {
  return str.UTF8.encode(text, false, U8.ErrorMode.ERROR);
}
