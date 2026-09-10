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

export function reviewBlockPageRange(
  pageIndex: number,
  blockCount: number,
  pageSize: number
) {
  const safeCount = Number.isFinite(blockCount)
    ? Math.max(0, Math.floor(blockCount))
    : 0;
  const safeSize = Number.isFinite(pageSize)
    ? Math.max(1, Math.floor(pageSize))
    : 1;
  const pageCount = Math.max(1, Math.ceil(safeCount / safeSize));
  const normalizedPage = Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0;
  const safePage = Math.max(0, Math.min(pageCount - 1, normalizedPage));
  const start = safePage * safeSize;
  return {
    pageIndex: safePage,
    pageCount,
    start,
    end: Math.min(safeCount, start + safeSize),
  };
}

export function adjacentReviewBlockPage(
  pageIndex: number,
  blockCount: number,
  pageSize: number,
  direction: ReviewNavigationDirection
) {
  const range = reviewBlockPageRange(pageIndex, blockCount, pageSize);
  return Math.max(
    0,
    Math.min(range.pageCount - 1, range.pageIndex + direction)
  );
}
