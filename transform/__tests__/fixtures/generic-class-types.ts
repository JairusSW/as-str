let defaultReads = 0;
class Box<T = string> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  get property(): T {
    return this.value;
  }
  set property(value: T) {
    this.value = value;
  }
  put(value: T): void {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
  defaulted<U = T>(): U {
    return changetype<U>(this.value);
  }
  defaultArgument<U = T>(value: U = changetype<U>(this.value)): U {
    return value;
  }
  defaultValue<U = T>(value: U = this.value): U {
    return value;
  }
  get observed(): T {
    defaultReads++;
    return this.value;
  }
  observedDefault<U = T>(value: U = this.observed): U {
    return value;
  }

  echo<T>(value: T): T {
    return value;
  }
}
type ViewBox = Box<str>;
class Derived<U> extends Box<U> {
  constructor(value: U) {
    super(value);
  }
}
class Nested<T> {
  inner: Box<T>;
  constructor(value: T) {
    this.inner = new Box<T>(value);
  }
}
export function mixedGenericFields(): i32 {
  const view = new Box<str>(str.from(""));
  const native = new Box<string>("");
  const primitive = new Box<i32>(7);
  view.value = "abc";
  native.value = str.from("defg");
  primitive.value = 9;
  const materialized: string = view.value;
  const wrapped: str = native.value;
  return materialized.length + wrapped.length + primitive.value;
}
export function genericAccessors(): i32 {
  const view = new Box<str>(str.from(""));
  const native = new Box<string>("");
  view.property = "abc";
  native.property = str.from("defg");
  const materialized: string = view.property;
  const wrapped: str = native.property;
  return materialized.length + wrapped.length;
}
export function genericInheritance(): i32 {
  const view = new Derived<str>(str.from(""));
  const native = new Derived<string>("");
  view.value = "abc";
  native.value = str.from("defg");
  return view.value.length + native.value.length;
}
export function nestedGenericFields(): i32 {
  const nested = new Nested<str>(str.from(""));
  nested.inner.value = "abc";
  const native: string = nested.inner.value;
  return native.length;
}
export function genericAliasFields(): i32 {
  const view: ViewBox = new Box<str>(str.from(""));
  view.value = "abc";
  const native: string = view.value;
  return native.length;
}
export function genericDefaultField(): i32 {
  const value = new Box("");
  value.value = str.from("abc");
  return value.value.length;
}
export function genericNullableAssertion(): i32 {
  const value = new Box<str | null>(str.from("abc"));
  const native: string = value.value!;
  return native.length;
}
export function genericNullableAssignment(): i32 {
  const value = new Box<str | null>(str.from("abc"));
  value.value = null;
  return value.value ? 1 : 17;
}

function identity<T>(value: T): T {
  return value;
}
export function genericMethods(): i32 {
  const view = new Box<str>(str.from(""));
  const native = new Box<string>("");
  const primitive = new Box<i32>(7);
  view.put("abc");
  native.put(str.from("defg"));
  primitive.put(9);
  const materialized: string = view.get();
  const wrapped: str = native.get();
  return materialized.length + wrapped.length + primitive.get();
}
export function genericFunctionCalls(): i32 {
  const materialized: string = identity<str>("abc");
  const wrapped: str = identity<string>(str.from("defg"));
  return materialized.length + wrapped.length + identity<i32>(9);
}
export function genericMethodShadow(): i32 {
  const view = new Box<str>(str.from(""));
  const native: string = view.echo<str>("abc");
  return native.length + view.echo<i32>(7);
}
export function genericInheritedMethods(): i32 {
  const view = new Derived<str>(str.from(""));
  view.put("abc");
  const native: string = view.get();
  return native.length;
}
export function nullableGenericCall(): i32 {
  const native: string = identity<str | null>(str.from("abc"))!;
  return native.length;
}
import {
  Box as ImportedBox,
  identity as importedIdentity,
  defaulted,
} from "./custom-types/generic";
export function importedGenericClass(): i32 {
  const box = new ImportedBox<str>(str.from(""));
  box.value = "abc";
  const fromField: string = box.value;
  box.put("defg");
  const fromMethod: string = box.get();
  return fromField.length + fromMethod.length;
}
export function importedGenericFunction(): i32 {
  const native: string = importedIdentity<str>("abc");
  const wrapped: str = defaulted(str.from("defg"));
  return native.length + wrapped.length + importedIdentity<i32>(9);
}

export function classContextDefaults(): i32 {
  const view = new Box<str>(str.from("abc"));
  const native = new Box<string>("defg");
  const primitive = new Box<i32>(9);
  const materialized: string = view.defaulted();
  const wrapped: str = native.defaulted();
  return materialized.length + wrapped.length + primitive.defaulted();
}

export function classDefaultArguments(): i32 {
  const view = new Box<str>(str.from("abc"));
  const native = new Box<string>("defg");
  const materialized: string = view.defaultArgument();
  const wrapped: str = native.defaultValue();
  return materialized.length + wrapped.length;
}
export function classDefaultReadOnce(): i32 {
  const view = new Box<str>(str.from("abc"));
  defaultReads = 0;
  const native: string = view.observedDefault();
  return defaultReads * 100 + native.length;
}

export function importedClassDefault(): i32 {
  const box = new ImportedBox<str>(str.from("abc"));
  const native: string = box.defaultValue();
  return native.length;
}
