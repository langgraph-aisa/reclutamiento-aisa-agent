export type ReviewNavigationDirection = -1 | 1;

export function adjacentReviewResultIndex(
  currentIndex: number,
  resultCount: number,
  direction: ReviewNavigationDirection
) {
  if (!Number.isInteger(resultCount) || resultCount <= 0) return -1;
  const normalizedCurrent =
    Number.isInteger(currentIndex) && currentIndex >= 0
      ? Math.min(currentIndex, resultCount - 1)
      : direction === 1
        ? -1
        : 0;
  return Math.max(0, Math.min(resultCount - 1, normalizedCurrent + direction));
}
