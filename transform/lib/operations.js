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
export const LENGTH_FUSIBLE_METHODS = new Set(VIEW_PRODUCING_METHODS);
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
export function isKnownViewMember(name) {
  return (
    VIEW_PRODUCING_METHODS.has(name) ||
    SCALAR_MEMBERS.has(name) ||
    NATIVE_PRODUCING_METHODS.has(name) ||
    OTHER_SAFE_VIEW_METHODS.has(name)
  );
}
