import "./branch-left";
import "./branch-right";


@global
function propagationBranch(value: string): i32 {
  return propagationLeft(value) + propagationRight(value);
}
