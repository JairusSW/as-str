export function identifierNonNullConversions(): i32 {
  const native: string | null = "abc";
  const view: str | null = str.from("wxyz");
  const wrapped: str = native!;
  const materialized: string = view!;
  return wrapped.length + materialized.length;
}

class MaybeValues {
  native: string | null = "abc";
  view: str | null = str.from("wxyz");
  get nativeProperty(): string | null {
    return this.native;
  }
  get viewProperty(): str | null {
    return this.view;
  }
}
export function fieldNonNullConversions(): i32 {
  const value = new MaybeValues();
  const wrapped: str = value.native!;
  const materialized: string = value.view!;
  return wrapped.length + materialized.length;
}
export function accessorNonNullConversions(): i32 {
  const value = new MaybeValues();
  const wrapped: str = value.nativeProperty!;
  const materialized: string = value.viewProperty!;
  return wrapped.length + materialized.length;
}
export function elementNonNullConversions(): i32 {
  const native = new Array<string | null>();
  native.push("abc");
  const view = new Array<str | null>();
  view.push(str.from("wxyz"));
  const wrapped: str = native[0]!;
  const materialized: string = view[0]!;
  return wrapped.length + materialized.length;
}

function convertNullableParameters(
  native: string | null,
  view: str | null,
): i32 {
  const wrapped: str = native!;
  const materialized: string = view!;
  return wrapped.length + materialized.length;
}
export function parameterNonNullConversions(): i32 {
  return convertNullableParameters("abc", str.from("wxyz"));
}
export function scopedNonNullConversions(): i32 {
  let length = 0;
  {
    const value: string | null = "abc";
    const wrapped: str = value!;
    length += wrapped.length;
  }
  {
    const value: str | null = str.from("wxyz");
    const materialized: string = value!;
    length += materialized.length;
  }
  return length;
}
function maybeNative(): string | null {
  return "abc";
}
function maybeView(): str | null {
  return str.from("wxyz");
}
export function callNonNullConversions(): i32 {
  const wrapped: str = maybeNative()!;
  const materialized: string = maybeView()!;
  return wrapped.length + materialized.length;
}
function materializeNullableCallback(callback: () => str | null): string {
  return callback()!;
}
export function callbackNonNullConversions(): i32 {
  return materializeNullableCallback((): str | null => str.from("abc")).length;
}
export function castConversions(): i32 {
  const native: string | null = "abc";
  const view: str | null = str.from("wxyz");
  const wrapped: str = native as string;
  const materialized: string = view as str;
  return wrapped.length + materialized.length;
}
const maybeGlobalView: str | null = str.from("abc");
export function globalNonNullConversions(): i32 {
  const materialized: string = maybeGlobalView!;
  return materialized.length;
}
class CountingMaybeView {
  reads: i32 = 0;
  get value(): str | null {
    this.reads++;
    return str.from("abc");
  }
}
export function getterNonNullReadOnce(): i32 {
  const value = new CountingMaybeView();
  const materialized: string = value.value!;
  return value.reads * 100 + materialized.length;
}
let indexReads: i32 = 0;
function nextIndex(): i32 {
  indexReads++;
  return 0;
}
export function elementNonNullReadOnce(): i32 {
  indexReads = 0;
  const values = new Array<str | null>();
  values.push(str.from("abc"));
  const materialized: string = values[nextIndex()]!;
  return indexReads * 100 + materialized.length;
}
export function nullableArrayNonNullConversions(): i32 {
  const values: Array<str | null> | null = new Array<str | null>();
  values!.push(str.from("abc"));
  const materialized: string = values![0]!;
  return materialized.length;
}
export function staticArrayNonNullConversions(): i32 {
  const values = new StaticArray<str | null>(1);
  values[0] = str.from("abc");
  const materialized: string = values[0]!;
  return materialized.length;
}
export function viewNonNullAt(): i32 {
  const value: str | null = str.from("");
  return value!.at(0).length;
}
export function nativeNonNullAt(): i32 {
  const value: string | null = "";
  return value!.at(0).length;
}
export function checkedNativeNull(): i32 {
  const value: string | null = null;
  const wrapped: str = value!;
  return wrapped.length;
}
export function checkedViewNull(): i32 {
  const value: str | null = null;
  const materialized: string = value!;
  return materialized.length;
}
