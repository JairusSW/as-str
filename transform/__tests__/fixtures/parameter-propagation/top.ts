import "./middle";


@global
function propagationTop(value: string): i32 {
  return propagationMiddle(value) + propagationMiddle(value);
}
