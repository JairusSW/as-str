import { read as readNative } from "./review-module-native";
import { read as readView } from "./review-module-view";

export function run(): i32 {
  return readNative() + readView();
}
