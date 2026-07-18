/** Methods that return a zero-copy UTF-16 view. */
export const VIEW_PRODUCING_METHODS = new Set([
  "slice",
  "substring",
  "substr",
  "trim",
  "trimStart",
  "trimEnd",
  "trimLeft",
  "trimRight",
  "charAt",
  "at",
  "before",
  "after",
  "between",
  "beforeLast",
  "afterLast",
  "betweenLast",
]);

/** View-producing methods that have an allocation-free `*Length` specialization. */
export const LENGTH_FUSIBLE_METHODS = new Set(VIEW_PRODUCING_METHODS);

/** Properties and methods whose result is not a string-like reference. */
export const SCALAR_MEMBERS = new Set([
  "length",
  "isEmpty",
  "charCodeAt",
  "codePointAt",
  "indexOf",
  "lastIndexOf",
  "includes",
  "startsWith",
  "endsWith",
  "localeCompare",
  "equals",
  "notEquals",
  "equalsString",
  "compareTo",
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
]);

/** Members available on Str whose result is a newly allocated native string. */
export const NATIVE_PRODUCING_METHODS = new Set([
  "concat",
  "repeat",
  "padStart",
  "padEnd",
  "replace",
  "replaceAll",
  "toUpperCase",
  "toLowerCase",
  "toString",
]);

export const OTHER_SAFE_VIEW_METHODS = new Set([
  "split",
  "toStr",
  "toStr8",
  "set",
]);

export function isKnownViewMember(name: string): boolean {
  return (
    VIEW_PRODUCING_METHODS.has(name) ||
    SCALAR_MEMBERS.has(name) ||
    NATIVE_PRODUCING_METHODS.has(name) ||
    OTHER_SAFE_VIEW_METHODS.has(name)
  );
}
