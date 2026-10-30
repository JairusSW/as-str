import { ASTBuilder, Source } from "assemblyscript/dist/assemblyscript.js";

const aliases = new WeakMap<Source, string>();

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
