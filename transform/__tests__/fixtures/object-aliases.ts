/* eslint-disable @typescript-eslint/no-namespace -- AssemblyScript namespace class-identity regression. */
class Holder {
  native: string = "";
  view: str = str.from("");
}
type Alias = Holder;
type Identity<T> = T;
function fill(holder: Alias): i32 {
  holder.view = "abc";
  holder.native = str.from("defg");
  return holder.view.length + holder.native.length;
}
export function annotatedObject(): i32 {
  const holder: Alias = new Holder();
  return fill(holder);
}
function factory(): Alias {
  return new Holder();
}
export function aliasFactory(): i32 {
  factory().view = "abc";
  const native: string = factory().view;
  return native.length;
}
class Wrapper {
  value: Alias = new Holder();
  get property(): Alias {
    return this.value;
  }
}
export function nestedAlias(): i32 {
  const wrapper = new Wrapper();
  wrapper.property.view = "abc";
  wrapper.value.native = str.from("defg");
  return wrapper.value.view.length + wrapper.property.native.length;
}
class Derived extends Holder {}
type DerivedAlias = Derived;
export function inheritedAlias(): i32 {
  const holder: DerivedAlias = new Derived();
  holder.view = "abc";
  holder.native = str.from("defg");
  return holder.view.length + holder.native.length;
}
export function nullableObjectAlias(): i32 {
  const holder: Alias | null = new Holder();
  holder!.view = "abc";
  const native: string = holder!.view;
  return native.length;
}
export function arrayObjectAlias(): i32 {
  const holders = new Array<Identity<Alias>>(1);
  holders[0] = new Holder();
  holders[0].view = "abc";
  holders[0].native = str.from("defg");
  return holders[0].view.length + holders[0].native.length;
}
function fromCallback(cb: () => Alias): i32 {
  cb().view = "abc";
  const native: string = cb().view;
  return native.length;
}
const shared = new Holder();
export function callbackObjectAlias(): i32 {
  return fromCallback((): Alias => shared);
}
namespace A {
  export class Holder {
    value: str = str.from("");
  }
  export type Value = Holder;
}
namespace B {
  export class Holder {
    value: string = "";
  }
  export function run(): i32 {
    const view: A.Value = new A.Holder();
    const native = new Holder();
    view.value = "abc";
    native.value = str.from("defg");
    return view.value.length + native.value.length;
  }
}
export function namespaceObjectAlias(): i32 {
  return B.run();
}
