import { ASTBuilder } from "assemblyscript/dist/assemblyscript.js";
const aliases = new WeakMap();
export function viewTypeAlias(source) {
  return aliases.get(source);
}
export function requestViewTypeAlias(source) {
  const existing = aliases.get(source);
  if (existing) return existing;
  const text = source.text + ASTBuilder.build(source);
  let name = "__as_str_view_type";
  let suffix = 0;
  while (text.includes(name)) name = `__as_str_view_type_${suffix++}`;
  aliases.set(source, name);
  return name;
}
