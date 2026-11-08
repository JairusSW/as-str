import { ASTBuilder, Source } from "assemblyscript/dist/assemblyscript.js";

const aliases = new WeakMap<Source, string>();
export type GeneratedTypeName = "i32" | "u64" | "string";
const scalarAliases = new WeakMap<Source, Map<GeneratedTypeName, string>>();

export function viewTypeAlias(source: Source): string | undefined {
  return aliases.get(source);
}

/** A module import alias that cannot be shadowed anywhere in the source. */
export function requestViewTypeAlias(source: Source): string {
  const existing = aliases.get(source);
  if (existing) return existing;
  const text = source.text + ASTBuilder.build(source);
  let name = "__as_str_view_type";
  let suffix = 0;
  while (text.includes(name)) name = `__as_str_view_type_${suffix++}`;
  aliases.set(source, name);
  return name;
}

export function scalarTypeAliases(
  source: Source,
): ReadonlyMap<GeneratedTypeName, string> | undefined {
  return scalarAliases.get(source);
}

/** A collision-free local name for a primitive alias exported by the runtime. */
export function requestScalarTypeAlias(
  source: Source,
  type: GeneratedTypeName,
): string {
  let requested = scalarAliases.get(source);
  if (!requested) scalarAliases.set(source, (requested = new Map()));
  const existing = requested.get(type);
  if (existing) return existing;
  // Scalar annotations can be requested while a rewrite is replacing an AST
  // child. The original source contains every application-defined binding we
  // must avoid and remains valid throughout that transient mutation.
  const text = source.text;
  let name = `__as_str_${type}_type`;
  let suffix = 0;
  while (text.includes(name)) name = `__as_str_${type}_type_${suffix++}`;
  requested.set(type, name);
  return name;
}
