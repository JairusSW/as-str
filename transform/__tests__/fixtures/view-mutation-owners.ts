import { str } from "../../../assembly/index";
let survivors = new Array<string>();
function make(): str {
  return str.from("A".repeat(1024));
}
function recycle(): void {
  __collect();
  __collect();
  __collect();
  survivors = new Array<string>();
  for (let i = 0; i < 200; i++) survivors.push("B".repeat(1024));
}
export function localView(): i32 {
  const view = make();
  const part = view.slice(0, 1024);
  view.set(str.from("new"));
  recycle();
  return part.charCodeAt(0);
}
function change(view: str): i32 {
  view.set(str.from("new"));
  recycle();
  return 0;
}
export function chainView(): i32 {
  const view = make();
  return view.slice(0, 1024).slice(change(view), 1).charCodeAt(0);
}
export function noGcControl(): i32 {
  const view = make();
  const part = view.slice(0, 1024);
  view.set(str.from("new"));
  return part.charCodeAt(0);
}
export function stableControl(): i32 {
  const view = make();
  const stablePart = view.slice(0, 1024);
  recycle();
  return stablePart.charCodeAt(0);
}
export function aliasView(): i32 {
  const view = make();
  const alias = view;
  const part = view.slice(0, 1024);
  alias.set(str.from("new"));
  recycle();
  return part.charCodeAt(0);
}
export function dataWrite(): i32 {
  const view = make();
  const part = view.slice(0, 1024);
  view.data = "new";
  recycle();
  return part.charCodeAt(0);
}

export function readAfterWrite(): i32 {
  const source = "A".repeat(8);
  const view = str.from(source);
  const part = view.slice(0);
  store<u16>(changetype<usize>(source), 66);
  return part.charCodeAt(0);
}
function mutatePart(part: str): void {
  part.set(str.from("C"));
}
export function readAfterHelper(): i32 {
  const source = "A".repeat(8);
  const view = str.from(source);
  const part = view.slice(0);
  store<u16>(changetype<usize>(source), 66);
  mutatePart(part);
  return part.charCodeAt(0);
}
class ReadOnlyBox {
  set(): i32 {
    return 0;
  }
}
export function userSetControl(): i32 {
  const view = make();
  const userSetPart = view.slice(0, 1024);
  new ReadOnlyBox().set();
  recycle();
  return userSetPart.charCodeAt(0);
}

export function arrayAliasView(): i32 {
  const view = make();
  const aliases = [view];
  const part = view.slice(0, 1024);
  aliases[0].set(str.from("new"));
  recycle();
  return part.charCodeAt(0);
}
export function arrayAliasData(): i32 {
  const view = make();
  const aliases = [view];
  const part = view.slice(0, 1024);
  aliases[0].data = "new";
  recycle();
  return part.charCodeAt(0);
}
function replaceData<T>(value: T): void {
  value.data = "new";
}
export function genericData(): i32 {
  const view = make();
  const part = view.slice(0, 1024);
  replaceData<str>(view);
  recycle();
  return part.charCodeAt(0);
}

class DataBox {
  data: string;
  constructor(value: string) {
    this.data = value;
  }
}
export function constructorControl(): i32 {
  const view = make();
  const constructorPart = view.slice(0, 1024);
  new DataBox("x");
  recycle();
  return constructorPart.charCodeAt(0);
}
