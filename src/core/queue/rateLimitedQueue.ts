export async function runRateLimitedQueue<T>(
  tasks: readonly ((signal?: AbortSignal) => Promise<T>)[],
  options: { concurrency?: number; intervalMs?: number; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void } = {},
): Promise<PromiseSettledResult<T>[]> {
  const { concurrency = 2, intervalMs = 250, signal, onProgress } = options;
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError('Invalid queue limits');
  }
  const results: PromiseSettledResult<T>[] = [];
  let nextIndex = 0;
  let nextStart = 0;
  let completed = 0;
  let startGate = Promise.resolve();

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      let task: Promise<T> | undefined;
      const start = startGate.then(async () => {
        signal?.throwIfAborted();
        await wait(Math.max(0, Math.ceil(nextStart - performance.now())), signal);
        signal?.throwIfAborted();
        nextStart = performance.now() + intervalMs;
        task = Promise.resolve(tasks[index](signal));
      });
      startGate = start.catch(() => {});
      try {
        await start;
        results[index] = { status: 'fulfilled', value: await task! };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
      onProgress?.(++completed, tasks.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timeout);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
