// Editor-only ambient typings for vstring's global mode. They let the TS
// language server resolve `vstring` (and the `VString` alias) with no explicit
// import; the `vstring` transform (`--transform vstring/transform`) injects the
// real runtime import at compile time.
//
// Loaded via the `vstring/globals.json` preset (add it to your
// assembly tsconfig's `extends` array). asc never loads this file, so there is
// no duplicate-identifier conflict with the injected import.
import { vstring as _vstring } from "vstring/assembly/index";

export {};

declare global {
  /** Zero-copy virtual string view: the type, the instance methods, and the
   *  static free-function API (`vstring.slice`, …). */
  type vstring = _vstring;
  const vstring: typeof _vstring;

  /** `VString` - a PascalCase alias for {@link vstring}. */
  type VString = _vstring;
  const VString: typeof _vstring;
}
