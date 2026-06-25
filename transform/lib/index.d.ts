import { Transform } from "assemblyscript/dist/transform.js";
import { Parser } from "assemblyscript/dist/assemblyscript.js";
export default class StrAsTransform extends Transform {
  afterParse(parser: Parser): void;
}
