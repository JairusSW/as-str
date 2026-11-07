import { mutate } from "./review-hidden-effects-helper";

export function run(): bool {
  const original = String.fromCharCodes([97, 98, 99, 100, 101, 102]);
  return original.slice(1, 4) == mutate(original);
}
