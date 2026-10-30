/* eslint-disable @typescript-eslint/no-namespace -- AssemblyScript namespace alias regression. */
import { Str as CustomView } from "./custom-types/str";
import { String as CustomString } from "./custom-types/string";
import {
  Text,
  View as ImportedView,
  Optional,
  Identity,
  Types,
} from "./custom-types/reexports";
import * as Reexported from "./custom-types/reexports";

type Native = string;
type View = str;
type Maybe<T> = T | null;
type WithDefault<T = string> = T;
type Alias<T> = Identity<T>;
class Holder {
  native: Native = "";
  view: View = str.from("");
}

export function aliasFields(): i32 {
  const holder = new Holder();
  holder.native = str.from("abc");
  holder.view = "defg";
  return holder.native.length + holder.view.length;
}
export function nullableAlias(): i32 {
  const view: Maybe<View> = str.from("abc");
  const materialized: Alias<Native> = view!;
  return materialized.length;
}
export function nullableAliasAssignment(): i32 {
  let view: Maybe<View> = str.from("abc");
  if (!view) return -1;
  view = null;
  return view ? 1 : 0;
}
export function aliasReturn(): Native {
  return str.from("abc");
}
export function aliasReturnLength(): i32 {
  return aliasReturn().length;
}
export function aliasDefault(): i32 {
  const native: WithDefault = str.from("abc");
  return native.length;
}
export function importedAliases(): i32 {
  const view: ImportedView = "abc";
  const native: Text = view;
  const optional: Optional<ImportedView> = str.from("defg");
  const materialized: Identity<Text> = optional!;
  return native.length + materialized.length;
}
export function namespaceImport(): i32 {
  const view: Reexported.View = "abc";
  const native: Reexported.Text = view;
  return native.length;
}
export function namespaceType(): i32 {
  const view: Types.View = "abc";
  const native: Types.Native = view;
  return native.length;
}
export function customView(): i32 {
  const value: CustomView = new CustomView();
  return value.slice(1, 2).length + value.at(50).length;
}
export function customString(): i32 {
  const value: CustomString = new CustomString();
  return value.slice(1, 2).length + value.at(50).length;
}
namespace Local {
  export type Native = str;
  export function run(): i32 {
    const value: Native = "abc";
    return value.length;
  }
}
export function namespaceAlias(): i32 {
  return Local.run();
}
type T = str;
function generic<T>(value: T): T {
  return value;
}
export function genericShadow(): i32 {
  return generic<i32>(42);
}
export function nestedNamespaceImport(): i32 {
  const view: Reexported.Types.View = "abc";
  const native: Reexported.Types.Native = view;
  return native.length;
}
export function explicitlyNativeInitializer(): i32 {
  const native: Native = str.from("abcdef").slice(1, 4);
  return native.length;
}
export function nativeAliasAtInvalid(): i32 {
  const native: Native = str.from("abc");
  return native.at(50).length;
}
export function viewAliasAtInvalid(): i32 {
  const view: View = "abc";
  return view.at(50).length;
}
type Callback<T> = () => T;
type Views<T> = Array<T>;
type NativeViews = Views<string>;
export function aliasCallback(): i32 {
  const cb: Callback<str> = (): str => str.from("abc");
  const native: string = cb();
  return native.length;
}
export function aliasArray(): i32 {
  const values: Views<str> = new Array<str>(1);
  values[0] = "abc";
  const native: string = values[0];
  return native.length;
}
export function aliasNativeArray(): i32 {
  const values: NativeViews = new Array<string>(1);
  values[0] = str.from("abc");
  const view: str = values[0];
  return view.length;
}
export function nullableAliasCallback(): i32 {
  const cb: Callback<Maybe<str>> = (): Maybe<str> => str.from("abc");
  const native: string = cb()!;
  return native.length;
}
type DefaultPrevious<A, B = A> = B;
export function dependentDefault(): i32 {
  const native: DefaultPrevious<string> = str.from("abc");
  return native.length;
}
export function nullableAliasArgument(): i32 {
  let view: Identity<Maybe<View>> = str.from("abc");
  if (!view) return -1;
  view = null;
  return view ? 1 : 0;
}
function readCallback(cb: Callback<str>): string {
  const native: string = cb();
  return native;
}
export function callbackParameterResult(): i32 {
  return readCallback((): str => str.from("abc")).length;
}
type Consumer<T> = (value: T) => i32;
function invokeConsumer(cb: Consumer<str>): i32 {
  return cb("abc");
}
export function callbackParameterArgument(): i32 {
  return invokeConsumer((value: str): i32 => value.length);
}
class CallbackHolder {
  cb: Callback<str> = (): str => str.from("abc");
}
export function callbackFieldResult(): i32 {
  const holder = new CallbackHolder();
  const native: string = holder.cb();
  return native.length;
}
export function noViewExplicit(): i32 {
  // @as-str no-view
  const view: str = str.from("abc");
  return view.at(50).length;
}
export function noViewInferred(): i32 {
  // @as-str no-view
  const view = str.from("abc");
  return view.at(50).length;
}

export function outerGenericAlias(): i32 {
  const view: T = "abc";
  return view.length;
}
