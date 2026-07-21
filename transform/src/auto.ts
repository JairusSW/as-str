import StrAsTransform from "./index.js";

export default class AutoStrTransform extends StrAsTransform {
  protected optimize = true;
  protected dualPass = true;
}
