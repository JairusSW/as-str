let source = "";
let survivors = new Array<string>();
function makeSource(): i32 {
  source = "A".repeat(1024);
  return 0;
}
function tail(at: i32, text: string): string {
  return text.slice(at);
}
function dropSource(expected: string): string {
  source = "";
  __collect();
  __collect();
  __collect();
  survivors = new Array<string>();
  for (let i = 0; i < 200; i++) survivors.push("B".repeat(1024));
  return expected;
}
export function run(): bool {
  source = "old";
  return tail(makeSource(), source) == dropSource("A".repeat(1024));
}
