type ViewList = Array<str>;
function read(values: ViewList): string {
  return values[0];
}
function push(values: ViewList): i32 {
  values.push("abc");
  return values[1].length;
}
export function arrayParameter(): i32 {
  const values = new Array<str>();
  values.push(str.from("defg"));
  return read(values).length + push(values);
}
function assign(values: ViewList): i32 {
  values[0] = "abc";
  const native: string = values[0];
  return native.length;
}
export function arrayParameterAssignment(): i32 {
  const values = new Array<str>(1);
  return assign(values);
}
class Lists {
  views: ViewList = new Array<str>(1);
}
export function arrayField(): i32 {
  const holder = new Lists();
  holder.views[0] = "abc";
  const native: string = holder.views[0];
  return native.length;
}
const globalViews = new Array<str>(1);
export function arrayGlobal(): i32 {
  globalViews[0] = "abc";
  const native: string = globalViews[0];
  return native.length;
}
export function nestedArray(): i32 {
  const values = new Array<ViewList>(1);
  values[0] = new Array<str>(1);
  values[0][0] = "abc";
  const native: string = values[0][0];
  return native.length;
}
let reads = 0;
class PropertyList {
  values: ViewList = new Array<str>(1);
  get views(): ViewList {
    reads++;
    return this.values;
  }
}
export function arrayGetterReadOnce(): i32 {
  const holder = new PropertyList();
  holder.values[0] = str.from("abc");
  reads = 0;
  const native: string = holder.views[0];
  return reads * 100 + native.length;
}
function nativeAssign(values: Array<string>): i32 {
  values[0] = str.from("abc");
  const view: str = values[0];
  return view.length;
}
export function nativeArrayParameter(): i32 {
  return nativeAssign(new Array<string>(1));
}
