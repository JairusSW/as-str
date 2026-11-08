import { str, str8 } from "../../../assembly/index";

export function utf16Instance(): i32 {
  return str.from('name="value"').betweenLast('"', '"').length;
}

export function utf16Static(): i32 {
  return str.betweenLast('name="value"', '"', '"').length;
}

export function utf16Length(): i32 {
  return str.betweenLastLength('name="value"', '"', '"');
}

export function utf8Instance(): i32 {
  return str8.from('name="value"').betweenLast('"', '"').length;
}

export function utf8Static(): i32 {
  return str8.betweenLast('name="value"', '"', '"').length;
}
