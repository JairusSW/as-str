import {
  consume as renamed,
  produce as make,
  alias,
  callback,
} from "./custom-types/functions";
import * as Functions from "./custom-types/functions";
import {
  again,
  make as reexportedMake,
  API as RenamedAPI,
} from "./custom-types/function-reexports";
import * as Reexported from "./custom-types/function-reexports";
export function renamedCalls(): i32 {
  const native: string = make();
  return renamed("defg") + native.length;
}
export function namespaceCalls(): i32 {
  const native: string = Functions.produce();
  return Functions.consume("defg") + native.length;
}
export function nestedNamespaceCalls(): i32 {
  const native: string = Functions.API.produce();
  return Functions.API.consume("abc") + native.length;
}
export function reexportCalls(): i32 {
  const native: string = reexportedMake();
  return again("defg") + native.length;
}
export function reexportNamespaceCalls(): i32 {
  const native: string = Reexported.make();
  const other: string = RenamedAPI.produce();
  return Reexported.again("defg") + native.length + other.length;
}
export function importedConstantAlias(): i32 {
  return alias("abc");
}
export function importedCallback(): i32 {
  const native: string = callback("abc");
  return native.length;
}
export function localImportedAlias(): i32 {
  const local = renamed;
  return local("abc");
}
import {
  consume as collide,
  mutable,
  replaceCallback,
} from "./custom-types/functions";
import { collide as other } from "./custom-types/other-functions";
export function collidingImportedName(): i32 {
  const view = str.from("abc");
  return collide(view) + other("defg");
}
export function mutableImportedCallback(): i32 {
  const native: string = mutable("abc");
  replaceCallback();
  const replaced: string = mutable("abc");
  return native.length * 10 + replaced.length;
}
import { sharedView } from "./custom-types/functions";
export function importedGlobalView(): i32 {
  const native: string = sharedView;
  return native.length;
}
export function namespacedGlobalView(): i32 {
  const native: string = Functions.sharedView;
  return native.length;
}
