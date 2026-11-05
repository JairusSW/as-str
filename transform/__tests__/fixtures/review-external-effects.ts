declare function change(value: string): void;
export function run(): bool {
  const original = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
  const part = original.slice(1, 4);
  change(original);
  return part == "bcd";
}
