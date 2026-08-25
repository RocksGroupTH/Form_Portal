export function nextAttemptNo(currentMax: number | null): number {
  return (currentMax ?? 0) + 1;
}
