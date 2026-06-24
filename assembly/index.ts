// vstring - virtual (zero-copy) strings for AssemblyScript.
//
//   import { vstring } from "vstring";
//
//   const real: string = "hello";
//   const v: vstring = vstring.slice(real, 2); // "llo" - no copy
//   v.toString();                              // "llo" - materialized
//
// `vstring` is the whole API: it is the type, carries the instance methods, and
// holds the static free-function surface (`vstring.slice(s, …)`). `VString` is
// exported as a PascalCase alias for the same class. See `./vstring.ts`.

/**
 * Package entry point for the `vstring` library - virtual (zero-copy) strings
 * for AssemblyScript. `VString` is a PascalCase alias of `vstring`; both refer
 * to the same class.
 */
export { vstring, vstring as VString } from "./vstring";
