export type CursorIterable<T> = AsyncIterable<T> & {
  currentCursor?: () => unknown;
};

export interface MergeStartState {
  nextSourceOnEqualTs?: 'DEPTH' | 'TRADES';
}
