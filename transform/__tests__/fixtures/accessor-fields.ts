class ViewProperty {
  private stored: str = str.from("");
  get value(): str {
    return this.stored;
  }
  set value(input: str) {
    this.stored = input;
  }
}
class NativeProperty {
  private stored: string = "";
  get value(): string {
    return this.stored;
  }
  set value(input: string) {
    this.stored = input;
  }
}
export function accessorConversions(): i32 {
  const view = new ViewProperty();
  const native = new NativeProperty();
  view.value = "abc";
  native.value = str.from("wxyz");
  const materialized: string = view.value;
  const wrapped: str = native.value;
  return materialized.length + wrapped.length;
}

class InheritedViewProperty extends ViewProperty {}
export function inheritedAccessorConversions(): i32 {
  const value = new InheritedViewProperty();
  value.value = "abcde";
  const materialized: string = value.value;
  return materialized.length;
}
class NestedAccessor {
  reads: i32 = 0;
  private child: ViewProperty = new ViewProperty();
  get box(): ViewProperty {
    this.reads++;
    return this.child;
  }
}
export function nestedAccessorFields(): i32 {
  const value = new NestedAccessor();
  value.box.value = "abc";
  const materialized: string = value.box.value;
  return value.reads * 100 + materialized.length;
}
class StaticViewProperty {
  private static stored: str = str.from("");
  static get value(): str {
    return StaticViewProperty.stored;
  }
  static set value(input: str) {
    StaticViewProperty.stored = input;
  }
}
export function staticAccessorConversions(): i32 {
  StaticViewProperty.value = "abcdef";
  const materialized: string = StaticViewProperty.value;
  return materialized.length;
}
class WriteOnlyViewProperty {
  private stored: str = str.from("");
  set value(input: str) {
    this.stored = input;
  }
  length(): i32 {
    return this.stored.length;
  }
}
export function setterOnlyConversions(): i32 {
  const value = new WriteOnlyViewProperty();
  value.value = "abcde";
  return value.length();
}
class CountingText {
  reads: i32 = 0;
  get text(): string {
    this.reads++;
    return " abc ";
  }
}
function packedAccessorLength(value: string): i32 {
  return value.length;
}
export function getterPackedArgument(): i32 {
  const value = new CountingText();
  const length = packedAccessorLength(value.text.slice(1, -1));
  return value.reads * 100 + length;
}
export function viewAccessorAt(): i32 {
  return new ViewProperty().value.at(0).length;
}
export function nativeAccessorAtInvalid(): i32 {
  return new NativeProperty().value.at(0).length;
}

class MixedStorage {
  static stored: str = str.from("");
  stored: string = "";
}
export function staticInstanceFieldConversions(): i32 {
  const value = new MixedStorage();
  MixedStorage.stored = "abc";
  value.stored = str.from("wxyz");
  const materialized: string = MixedStorage.stored;
  const wrapped: str = value.stored;
  return materialized.length + wrapped.length;
}
class MixedProperties {
  private static stored: str = str.from("");
  private stored: string = "";
  static get value(): str {
    return MixedProperties.stored;
  }
  static set value(input: str) {
    MixedProperties.stored = input;
  }
  get value(): string {
    return this.stored;
  }
  set value(input: string) {
    this.stored = input;
  }
}
export function staticInstanceAccessorConversions(): i32 {
  const value = new MixedProperties();
  MixedProperties.value = "abc";
  value.value = str.from("wxyz");
  const materialized: string = MixedProperties.value;
  const wrapped: str = value.value;
  return materialized.length + wrapped.length;
}
class MixedMethods {
  static consume(value: str): str {
    return value;
  }
  consume(value: string): string {
    return value;
  }
}
export function staticInstanceMethodConversions(): i32 {
  const materialized: string = MixedMethods.consume("abc");
  const wrapped: str = new MixedMethods().consume(str.from("wxyz"));
  return materialized.length + wrapped.length;
}
class MixedHolder {
  private static stored: ViewProperty = new ViewProperty();
  private stored: NativeProperty = new NativeProperty();
  static get child(): ViewProperty {
    return MixedHolder.stored;
  }
  get child(): NativeProperty {
    return this.stored;
  }
}
export function staticInstanceObjectAccessors(): i32 {
  const value = new MixedHolder();
  MixedHolder.child.value = "abc";
  value.child.value = str.from("wxyz");
  const materialized: string = MixedHolder.child.value;
  const wrapped: str = value.child.value;
  return materialized.length + wrapped.length;
}
