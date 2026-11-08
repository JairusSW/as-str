import { ASTBuilder } from "assemblyscript/dist/assemblyscript.js";
const aliases = new WeakMap();
const scalarAliases = new WeakMap();
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
export function scalarTypeAliases(source) {
  return scalarAliases.get(source);
}
export function requestScalarTypeAlias(source, type) {
  let requested = scalarAliases.get(source);
  if (!requested) scalarAliases.set(source, (requested = new Map()));
  const existing = requested.get(type);
  if (existing) return existing;
  const text = source.text;
  let name = `__as_str_${type}_type`;
  let suffix = 0;
  while (text.includes(name)) name = `__as_str_${type}_type_${suffix++}`;
  requested.set(type, name);
  return name;
}
