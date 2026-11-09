/* eslint-disable @typescript-eslint/no-wrapper-object-types */

import { str } from "../../../assembly/index";

function makeView(): str {
  return str.from("abc");
}

export const callback: () => Object = makeView;
