/* eslint-disable @typescript-eslint/no-wrapper-object-types */
import { str } from "../../../assembly/index";
import { callback } from "./object-widening-callback";

function compare(other: Object): bool {
  return callback() === other;
}

export function importedCallback(): i32 {
  return compare(str.from("abc")) ? 1 : 0;
}
