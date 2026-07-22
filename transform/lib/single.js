import StrAsTransform from "./index.js";
export default class SinglePassStrAsTransform extends StrAsTransform {
  optimize = true;
  dualPass = false;
}
