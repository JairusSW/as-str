import "./leaf";


@global
function propagationMiddle(value: string): i32 {
  return propagationLeaf(value) + propagationLeaf(value);
}
