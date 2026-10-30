import { Holder, HolderAlias, Derived, Models } from "./custom-types/holder";
import * as Objects from "./custom-types/holder";
class Wrapper {
  value: HolderAlias = new Holder();
}
export function importedFields(): i32 {
  const holder = new Holder();
  holder.view = "abc";
  holder.native = str.from("defg");
  return holder.view.length + holder.native.length;
}
export function importedStatic(): i32 {
  Holder.view = "abc";
  Holder.native = str.from("defg");
  return Holder.view.length + Holder.native.length;
}
export function importedMethod(): i32 {
  const holder = new Holder();
  const native: string = holder.take("abc");
  return native.length;
}
export function importedAccessors(): i32 {
  const holder = new Holder();
  holder.viewProperty = "abc";
  holder.nativeProperty = str.from("defg");
  const native: string = holder.viewProperty;
  const view: str = holder.nativeProperty;
  return native.length + view.length;
}
export function importedNested(): i32 {
  const wrapper = new Wrapper();
  wrapper.value.view = "abc";
  const native: string = wrapper.value.view;
  return native.length;
}
export function importedInherited(): i32 {
  const holder = new Derived();
  holder.view = "abc";
  holder.native = str.from("defg");
  return holder.view.length + holder.native.length;
}
export function importedNamespace(): i32 {
  const holder = new Objects.Models.Holder();
  holder.value = "abc";
  Models.Holder.value = "defg";
  const native: string = holder.value;
  const other: string = Objects.Models.Holder.value;
  return native.length + other.length;
}
export function importedArray(): i32 {
  const values = new Array<HolderAlias>(1);
  values[0] = new Holder();
  values[0].view = "abc";
  const native: string = values[0].view;
  return native.length;
}
