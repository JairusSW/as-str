import { measure } from "barrel-api";

export function outside(): i32 {
  return measure("xyz");
}
