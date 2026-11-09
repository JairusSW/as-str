import "./parameter-propagation/leaf";
import "./parameter-propagation/middle";

export function run(): i32 {
  return propagationMiddle(" abc ");
}
