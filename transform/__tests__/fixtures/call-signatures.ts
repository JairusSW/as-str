/* eslint-disable @typescript-eslint/no-namespace -- AssemblyScript namespace-resolution regression. */
class ViewConsumer {
  slice(value: str): str {
    return value;
  }
  includes(value: str): i32 {
    return value.length;
  }
  consume(value: str): i32 {
    return value.length;
  }
}
class NativeConsumer {
  slice(value: string): string {
    return value;
  }
  includes(value: string): i32 {
    return value.length;
  }
  consume(value: string): i32 {
    return value.length;
  }
}
export function sameNamedMethods(): i32 {
  const view = new ViewConsumer();
  const native = new NativeConsumer();
  return view.consume("abc") + native.consume(str.from("wxyz"));
}
namespace ViewCalls {
  export function invoke(): i32 {
    return consume("abc");
  }
  export function consume(value: str): i32 {
    return value.length;
  }
}
namespace NativeCalls {
  export function invoke(): i32 {
    return consume(str.from("wxyz"));
  }
  export function consume(value: string): i32 {
    return value.length;
  }
}
export function sameNamedNamespaceCalls(): i32 {
  return ViewCalls.consume("abc") + NativeCalls.consume(str.from("wxyz"));
}

export function familiarMethodSignatures(): i32 {
  const view = new ViewConsumer();
  const native = new NativeConsumer();
  const materialized: string = view.slice("abc");
  const wrapped: str = native.slice(str.from("wxyz"));
  return (
    materialized.length +
    wrapped.length +
    view.includes("ab") +
    native.includes(str.from("xyz"))
  );
}

class InheritedViewConsumer extends ViewConsumer {}
export function inheritedMethodSignatures(): i32 {
  const value = new InheritedViewConsumer();
  const materialized: string = value.slice("abcde");
  return value.consume("abc") + materialized.length;
}
class StaticViewConsumer {
  static consume(value: str): str {
    return value;
  }
}
class StaticNativeConsumer {
  static consume(value: string): string {
    return value;
  }
}
export function staticMethodSignatures(): i32 {
  const materialized: string = StaticViewConsumer.consume("abc");
  const wrapped: str = StaticNativeConsumer.consume(str.from("wxyz"));
  return materialized.length + wrapped.length;
}
export function unqualifiedNamespaceCalls(): i32 {
  return ViewCalls.invoke() + NativeCalls.invoke();
}
