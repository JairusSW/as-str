export type OperationResult =
  | "view"
  | "native"
  | "scalar"
  | "other-safe"
  | "unknown";

export interface OperationSemantics {
  readonly result: OperationResult;
  readonly lengthFusible: boolean;
  readonly spanProducing: boolean;
  readonly spanScalar: boolean;
  readonly container: boolean;
  readonly normalizedSpanName: string;
}

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
const SEMANTICS = new Map<string, OperationSemantics>();
const UNKNOWN_SEMANTICS: OperationSemantics = {
  result: "unknown",
  lengthFusible: false,
  spanProducing: false,
  spanScalar: false,
  container: false,
  normalizedSpanName: "",
};

function resultFor(name: string): OperationResult {
  if (VIEW_PRODUCING_METHODS.has(name)) return "view";
  if (SCALAR_MEMBERS.has(name)) return "scalar";
  if (NATIVE_PRODUCING_METHODS.has(name)) return "native";
  if (OTHER_SAFE_VIEW_METHODS.has(name)) return "other-safe";
  return "unknown";
}

/**
 * The single semantic authority for string operations understood by the
 * optimizer. Callers ask what an operation means without learning how the
 * overlapping runtime capability groups are represented.
 */
export function operationSemantics(name: string): OperationSemantics {
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
