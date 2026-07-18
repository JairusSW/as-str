import { Parser, Source } from "assemblyscript/dist/assemblyscript.js";
import path from "path";
export declare const PACKAGE_NAME = "as-str";
export declare const VIEW_NAME = "str";
export declare function isPackageSource(source: Source): boolean;
export declare function normalizeBaseRel(baseRel: string): string;
export declare function computeImportBaseRel(
  fromDir: string,
  packageDir: string,
  p?: typeof path,
): string;
export declare function viewNameAvailable(source: Source): boolean;
export interface ImportInjectionOptions {
  baseCWD: string;
  packageDir: string;
  debug: boolean;
  force?: ReadonlySet<Source>;
  log(message: string): void;
}
export declare function injectViewImports(
  parser: Parser,
  options: ImportInjectionOptions,
): void;
