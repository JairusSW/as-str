export function packedMember(): bool {
  const part = "abc".slice(1);
  return isDefined(part.isEmpty);
}

export function viewMember(): bool {
  const part = "abc".slice(1);
  return part.length > 0 && part.charCodeAt(0) == 98 && isDefined(part.set);
}

export function existingMember(): bool {
  const part = "abc".slice(1);
  return isDefined(part.length);
}
