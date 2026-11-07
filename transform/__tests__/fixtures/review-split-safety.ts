import { str } from "../../../assembly/index";
export function fieldSet(): i32 {
  const view = str.from("a,b");
  const parts = view.split(",");
  parts[0].set(str.from("x"));
  return parts[0].charCodeAt(0);
}
export function fieldAlias(): i32 {
  const view = str.from("a,b");
  const parts = view.split(",");
  const field = parts[0];
  field.set(str.from("x"));
  return parts[0].charCodeAt(0);
}
function mutateField(field: str): void {
  field.set(str.from("x"));
}
export function fieldHelper(): i32 {
  const view = str.from("a,b");
  const parts = view.split(",");
  mutateField(parts[0]);
  return parts[0].charCodeAt(0);
}
function setView(view: str): i32 {
  view.set(str.from("x,y,z"));
  return 0;
}
export function directViewIndex(): i32 {
  const view = str.from("a,b");
  return view.split(",")[setView(view)].charCodeAt(0);
}
export function directViewSlice(): i32 {
  const view = str.from("a,b");
  return view.split(",")[setView(view)].slice(0).charCodeAt(0);
}
export function counterAssign(): i32 {
  const parts = "a,bb,ccc,dddd".split(",");
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    total += parts[i].length;
    // prettier-ignore
    ((i)) += 1;
  }
  return total;
}
export function parenthesizedField(): i32 {
  const parts = "a,b".split(",");
  // prettier-ignore
  ((parts[0])) = "changed";
  return parts[0].length;
}
export function parenthesizedLength(): i32 {
  const parts = "a,b".split(",");
  // prettier-ignore
  ((parts.length)) = 1;
  return parts.length;
}
