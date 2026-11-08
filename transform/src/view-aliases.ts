import { ASTBuilder, Source } from "assemblyscript/dist/assemblyscript.js";

const aliases = new WeakMap<Source, string>();
const scalarAliases = new WeakMap<Source, Map<"i32" | "u64", string>>();

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
): ReadonlyMap<"i32" | "u64", string> | undefined {
  return scalarAliases.get(source);
}

/** A collision-free local name for a primitive alias exported by the runtime. */
export function requestScalarTypeAlias(
  source: Source,
  type: "i32" | "u64",
): string {
  let requested = scalarAliases.get(source);
  if (!requested) scalarAliases.set(source, (requested = new Map()));
  const existing = requested.get(type);
  if (existing) return existing;
  const text = source.text + ASTBuilder.build(source);
  let name = `__as_str_${type}_type`;
  let suffix = 0;
  while (text.includes(name)) name = `__as_str_${type}_type_${suffix++}`;
  requested.set(type, name);
  return name;
}
