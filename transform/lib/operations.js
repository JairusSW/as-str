const VIEW_PRODUCING_METHODS = new Set([
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
const SPAN_PRODUCING_METHODS = new Set([
  "slice",
  "substring",
  "substr",
  "trim",
  "trimStart",
  "trimEnd",
  "trimLeft",
  "trimRight",
]);
const SCALAR_MEMBERS = new Set([
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
const SPAN_SCALAR_METHODS = new Set([
  "charCodeAt",
  "codePointAt",
  "indexOf",
  "lastIndexOf",
  "includes",
  "startsWith",
  "endsWith",
]);
const NATIVE_PRODUCING_METHODS = new Set([
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
const OTHER_SAFE_VIEW_METHODS = new Set(["split", "toStr", "toStr8", "set"]);
const VIEW_CONTAINER_METHODS = new Set(["split"]);
const SEMANTICS = new Map();
const UNKNOWN_SEMANTICS = {
  result: "unknown",
  lengthFusible: false,
  spanProducing: false,
  spanScalar: false,
  container: false,
  normalizedSpanName: "",
};
function resultFor(name) {
  if (VIEW_PRODUCING_METHODS.has(name)) return "view";
  if (SCALAR_MEMBERS.has(name)) return "scalar";
  if (NATIVE_PRODUCING_METHODS.has(name)) return "native";
  if (OTHER_SAFE_VIEW_METHODS.has(name)) return "other-safe";
  return "unknown";
}
export function operationSemantics(name) {
  const cached = SEMANTICS.get(name);
  if (cached) return cached;
  const result = resultFor(name);
  if (result === "unknown") return UNKNOWN_SEMANTICS;
  const semantics = {
    result,
    lengthFusible: VIEW_PRODUCING_METHODS.has(name),
    spanProducing: SPAN_PRODUCING_METHODS.has(name),
    spanScalar: SPAN_SCALAR_METHODS.has(name),
    container: VIEW_CONTAINER_METHODS.has(name),
    normalizedSpanName:
      name === "trimLeft"
        ? "trimStart"
        : name === "trimRight"
          ? "trimEnd"
          : name,
  };
  SEMANTICS.set(name, semantics);
  return semantics;
}
