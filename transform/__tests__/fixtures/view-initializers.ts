const emptyView: str = str.from("");
const globalAt = emptyView.at(0);
const globalLength = emptyView.at(0).length;
class ViewInitializer {
  view: str = str.from("");
  result: str = this.view.at(0);
  length: i32 = this.view.at(0).length;
}
export function globalViewAt(): i32 {
  return globalAt.length + globalLength;
}
export function fieldViewAt(): i32 {
  const value = new ViewInitializer();
  return value.result.length + value.length;
}
export function localViewAt(): i32 {
  const view = str.from("");
  return view.at(0).length;
}
