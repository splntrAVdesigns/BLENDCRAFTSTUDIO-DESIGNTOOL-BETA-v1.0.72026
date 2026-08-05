// Verify the race+forced-close logic in three scenarios.
class MockEncoder {
  state: 'configured' | 'closed' = 'configured';
  encodeQueueSize = 3;
  private resolveFlush: (() => void) | null = null;
  private rejectFlush: ((e: Error) => void) | null = null;
  constructor(private behavior: 'healthy' | 'stalls-forever') {}
  flush(): Promise<void> {
    if (this.behavior === 'healthy') return new Promise((r) => setTimeout(r, 20));
    return new Promise((resolve, reject) => { this.resolveFlush = resolve; this.rejectFlush = reject; });
  }
  close() {
    this.state = 'closed';
    if (this.rejectFlush) { this.rejectFlush(new DOMException('closed', 'InvalidStateError')); this.rejectFlush = null; }
  }
}

function abortErr() { return new DOMException('Cancelled', 'AbortError'); }

async function finish(enc: MockEncoder, opts: { signal?: AbortSignal; deadlineMs: number }): Promise<string> {
  const { signal, deadlineMs } = opts;
  if (signal?.aborted) { enc.close(); throw abortErr(); }
  let settled = false, timer: any, onAbort: (() => void) | undefined;
  const cleanup = () => { settled = true; clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); };
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      cleanup(); enc.close();
      reject(new Error(`stalled after ${deadlineMs}ms`));
    }, deadlineMs);
    onAbort = () => { if (settled) return; cleanup(); enc.close(); reject(abortErr()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const flushPromise = enc.flush().then(() => { cleanup(); });
    flushPromise.catch(() => {});
    await Promise.race([flushPromise, guard]);
    return 'RESOLVED';
  } catch (e) {
    cleanup();
    return `REJECTED: ${(e as Error).message ?? (e as any).name}`;
  }
}

(async () => {
  console.log('healthy flush:         ', await finish(new MockEncoder('healthy'), { deadlineMs: 500 }));
  console.log('stalled -> timeout:     ', await finish(new MockEncoder('stalls-forever'), { deadlineMs: 300 }));

  const ac = new AbortController();
  const stalledEnc = new MockEncoder('stalls-forever');
  const p = finish(stalledEnc, { signal: ac.signal, deadlineMs: 5000 });
  setTimeout(() => ac.abort(), 100);
  console.log('stalled -> user cancel: ', await p);
})();
