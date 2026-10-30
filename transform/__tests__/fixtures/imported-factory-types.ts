import {
  create as make,
  populated,
  reset,
  count,
  shared,
  callback,
  replace,
} from "./custom-types/factories";
import * as Factories from "./custom-types/factories";
export function renamedFactory(): i32 {
  const holder = make();
  holder.view = "abc";
  holder.native = str.from("defg");
  return holder.view.length + holder.native.length;
}
export function namespaceFactory(): i32 {
  const holder = Factories.create();
  holder.view = "abc";
  const native: string = holder.view;
  return native.length;
}
export function factoryReadOnce(): i32 {
  reset();
  const native: string = populated().view;
  return count() * 100 + native.length;
}
export function importedGlobalObject(): i32 {
  shared.view = "abc";
  const native: string = shared.view;
  return native.length;
}
export function mutableFactoryCallback(): i32 {
  replace();
  callback().view = "abcde";
  const native: string = callback().view;
  return native.length;
}
