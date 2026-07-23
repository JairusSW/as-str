import StrAsTransform from "./index.js";

/** Automatic string-view optimization without the shadow semantic pass. */
export default class SinglePassStrAsTransform extends StrAsTransform {
  protected override optimize = true;
  protected override dualPass = false;
}
