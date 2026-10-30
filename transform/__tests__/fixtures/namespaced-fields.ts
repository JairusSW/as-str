/* eslint-disable @typescript-eslint/no-namespace -- AssemblyScript namespace-resolution regression. */
namespace ViewSide {
  export class Box {
    payload: str = str.from("");
    assign(input: string): void {
      this.payload = input;
    }
  }
}
namespace NativeSide {
  export class Box {
    payload: string = "";
    assign(input: str): void {
      this.payload = input;
    }
  }
}
export function namespacedFieldConversions(): i32 {
  const view = new ViewSide.Box();
  const native = new NativeSide.Box();
  view.assign("abc");
  native.assign(str.from("wxyz"));
  return view.payload.length + native.payload.length;
}

namespace ViewSide {
  export class Derived extends ViewSide.Box {
    assignChild(input: string): void {
      this.payload = input;
    }
  }
  export function assignBox(value: ViewSide.Box, input: string): void {
    value.payload = input;
  }
  export namespace Nested {
    export class Box {
      payload: string = "";
      assign(input: str): void {
        this.payload = input;
      }
    }
  }
}
export function namespacedInheritedFields(): i32 {
  const value = new ViewSide.Derived();
  value.assignChild("abcde");
  return value.payload.length;
}
export function namespacedParameterFields(): i32 {
  const value = new ViewSide.Box();
  ViewSide.assignBox(value, "abcd");
  return value.payload.length;
}
export function nestedNamespaceFields(): i32 {
  const value = new ViewSide.Nested.Box();
  value.assign(str.from("abcdef"));
  return value.payload.length;
}

const globalBox = new ViewSide.Box();
export function globalObjectFields(): i32 {
  globalBox.payload = "abc";
  return globalBox.payload.length;
}
export function aliasedObjectFields(): i32 {
  const original = new ViewSide.Box();
  const alias = original;
  alias.payload = "abcd";
  return alias.payload.length;
}

const aliasSource = new ViewSide.Box();
const globalAlias = aliasSource;
export function globalAliasShadowing(): i32 {
  const aliasSource = new NativeSide.Box();
  globalAlias.payload = "abc";
  aliasSource.payload = str.from("wxyz");
  return globalAlias.payload.length + aliasSource.payload.length;
}
namespace ViewSide {
  export const shared = new ViewSide.Box();
}
export function namespacedGlobalFields(): i32 {
  ViewSide.shared.payload = "abcdef";
  return ViewSide.shared.payload.length;
}
export function namespaceShadowFields(): i32 {
  const ViewSide = new NativeSide.Box();
  ViewSide.payload = str.from("abc");
  return ViewSide.payload.length;
}

function makeViewBox(): ViewSide.Box {
  return new ViewSide.Box();
}
export function factoryObjectFields(): i32 {
  const value = makeViewBox();
  value.payload = "abcde";
  return value.payload.length;
}
export function directFactoryFields(): i32 {
  makeViewBox().payload = "abcdef";
  const value = makeViewBox();
  return value.payload.length;
}

class BoxFactory {
  make(): ViewSide.Box {
    return new ViewSide.Box();
  }
  static build(): NativeSide.Box {
    return new NativeSide.Box();
  }
}
class DerivedBoxFactory extends BoxFactory {}
export function methodFactoryFields(): i32 {
  const factory = new DerivedBoxFactory();
  const view = factory.make();
  view.payload = "abc";
  const native = BoxFactory.build();
  native.payload = str.from("wxyz");
  return view.payload.length + native.payload.length;
}
function useFactoryCallback(makeViewBox: () => NativeSide.Box): i32 {
  const value = makeViewBox();
  value.payload = str.from("abcdef");
  return value.payload.length;
}
function makeNativeBox(): NativeSide.Box {
  return new NativeSide.Box();
}
export function callbackFactoryFields(): i32 {
  return useFactoryCallback(makeNativeBox);
}

export function lexicalFactoryShadowing(): i32 {
  function makeViewBox(): NativeSide.Box {
    return new NativeSide.Box();
  }
  const value = makeViewBox();
  value.payload = str.from("abc");
  return value.payload.length;
}
class NestedContainer {
  box: ViewSide.Box = new ViewSide.Box();
}
export function nestedObjectFields(): i32 {
  const container = new NestedContainer();
  container.box.payload = "abcde";
  return container.box.payload.length;
}

class DerivedContainer extends NestedContainer {}
export function nestedInheritedFields(): i32 {
  const container = new DerivedContainer();
  container.box.payload = "abcdef";
  return container.box.payload.length;
}

export function callbackExpressionFields(): i32 {
  const create = (): ViewSide.Box => new ViewSide.Box();
  const value = create();
  value.payload = "abcdefg";
  return value.payload.length;
}
export function blockFactoryShadowing(): i32 {
  let score = 0;
  {
    function makeViewBox(): NativeSide.Box {
      return new NativeSide.Box();
    }
    const value = makeViewBox();
    value.payload = str.from("abc");
    score += value.payload.length;
  }
  const value = makeViewBox();
  value.payload = "abcd";
  return score + value.payload.length;
}

export function blockCallbackShadowing(): i32 {
  const create = (): ViewSide.Box => new ViewSide.Box();
  let score = 0;
  {
    const create = (): NativeSide.Box => new NativeSide.Box();
    const value = create();
    value.payload = str.from("abc");
    score += value.payload.length;
  }
  const value = create();
  value.payload = "abcd";
  return score + value.payload.length;
}
