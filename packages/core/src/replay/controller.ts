import type { ReplayController } from './types.js';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = () => {
      res();
    };
  });
  return { promise, resolve };
}

export function createReplayController(): ReplayController {
  let paused = false;
  let deferred: Deferred | undefined;

  function ensureDeferred(): Deferred {
    if (!deferred) {
      deferred = createDeferred();
    }
    return deferred;
  }

  function resolveDeferred(): void {
    if (!deferred) return;
    const current = deferred;
    deferred = undefined;
    current.resolve();
  }

  return {
    pause(): void {
      if (paused) return;
      paused = true;
      ensureDeferred();
    },
    resume(): void {
      if (!paused) return;
      paused = false;
      resolveDeferred();
    },
    isPaused(): boolean {
      return paused;
    },
    waitUntilResumed(): Promise<void> {
      if (!paused) {
        return Promise.resolve();
      }
      return ensureDeferred().promise;
    },
  } satisfies ReplayController;
}
