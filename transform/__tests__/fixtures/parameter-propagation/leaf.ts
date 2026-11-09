
@global
function propagationLeaf(value: string): i32 {
  return str.slice(value, 1).length + str.trim(value).length;
}
