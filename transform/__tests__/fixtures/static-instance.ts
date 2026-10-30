class MixedAccessors {
  static get value(): str {
    return str.from("");
  }
  get value(): string {
    return "abc";
  }
}
export function staticAccessorAt(): i32 {
  return MixedAccessors.value.at(0).length;
}
export function instanceAccessorAt(): i32 {
  return new MixedAccessors().value.at(0).length;
}
export function instanceAccessorAtInvalid(): i32 {
  return new MixedAccessors().value.at(99).length;
}
class ReverseAccessors {
  static get value(): string {
    return "";
  }
  get value(): str {
    return str.from("abc");
  }
}
export function instanceViewAccessorAt(): i32 {
  return new ReverseAccessors().value.at(99).length;
}
export function staticNativeAccessorAtInvalid(): i32 {
  return ReverseAccessors.value.at(0).length;
}
class MixedFields {
  static value: str = str.from("");
  value: string = "abc";
}
export function staticFieldAt(): i32 {
  return MixedFields.value.at(0).length;
}
export function instanceFieldAt(): i32 {
  return new MixedFields().value.at(0).length;
}
export function instanceFieldAtInvalid(): i32 {
  return new MixedFields().value.at(99).length;
}
class ReverseFields {
  static value: string = "";
  value: str = str.from("abc");
}
export function instanceViewFieldAt(): i32 {
  return new ReverseFields().value.at(99).length;
}
export function staticNativeFieldAtInvalid(): i32 {
  return ReverseFields.value.at(0).length;
}
