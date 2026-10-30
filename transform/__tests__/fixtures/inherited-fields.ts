class BaseFields {
  view: str = str.from("");
  native: string = "";
}
class DerivedFields extends BaseFields {
  assign(input: string, incoming: str): void {
    this.view = input;
    this.native = incoming;
  }
}
export function inheritedFieldConversions(): i32 {
  const value = new DerivedFields();
  value.assign("abc", str.from("xyz"));
  return value.view.length + value.native.length;
}

class FinalFields extends DerivedFields {
  assignAgain(input: string, incoming: str): void {
    this.view = input;
    this.native = incoming;
  }
}
export function multiLevelFieldConversions(): i32 {
  const value = new FinalFields();
  value.assignAgain("abcd", str.from("xyz"));
  return value.view.length + value.native.length;
}
export function nullableFieldConversions(): i32 {
  const value: FinalFields | null = new FinalFields();
  value!.view = "abcde";
  return value!.view.length;
}
