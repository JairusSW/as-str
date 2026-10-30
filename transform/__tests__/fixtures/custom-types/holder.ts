/* eslint-disable @typescript-eslint/no-namespace -- AssemblyScript imported class namespace regression. */
import { str } from "../../../../assembly/index";
export class Holder {
  native: string = "";
  view: str = str.from("");
  static native: string = "";
  static view: str = str.from("");
  take(value: str): str {
    return value;
  }
  get viewProperty(): str {
    return this.view;
  }
  set viewProperty(value: str) {
    this.view = value;
  }
  get nativeProperty(): string {
    return this.native;
  }
  set nativeProperty(value: string) {
    this.native = value;
  }
}
export class Derived extends Holder {}
export type HolderAlias = Holder;
export namespace Models {
  export class Holder {
    value: str = str.from("");
    static value: str = str.from("");
  }
}
