import { str8 } from "../../index";
export function validate(bytes: ArrayBuffer): bool {
  return str8.UTF8.validate(bytes);
}
export function checked(bytes: ArrayBuffer): bool {
  return str8.fromBufferChecked(bytes).length == bytes.byteLength;
}
