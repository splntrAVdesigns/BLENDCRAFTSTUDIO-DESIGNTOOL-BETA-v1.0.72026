/**
 * Reproduces the EXPORT LOOP CONTROL FLOW with a mock VideoEncoder that models
 * libvpx lag-in-frames behaviour. This is the test that the earlier throughput
 * probes could not be: it exercises backpressure + lookahead together.
 */

type Listener = () => void;

class MockVideoEncoder {
  encodeQueueSize = 0;
  private listeners: Listener[] = [];
  private buffered = 0;
  private outputs = 0;
  private closed = false;

  /**
   * lagInFrames models libvpx: in 'quality' mode the encoder accumulates this
   * many frames before it emits/drains anything. In 'realtime' mode it is 0.
   */
  constructor(private lagInFrames: number, private onOutput: () => void) {}

  addEventListener(_: string, fn: Listener) { this.listeners.push(fn); }
  removeEventListener(_: string, fn: Listener) {
    const i = this.listeners.indexOf(fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  private emitDequeue() { for (const fn of this.listeners.slice()) fn(); }

  encode() {
    if (this.closed) return;
    this.encodeQueueSize += 1;
    this.buffered += 1;
    // Encoder does async work; it only drains once past the lookahead window.
    setTimeout(() => {
      if (this.closed) return;
      if (this.buffered > this.lagInFrames) {
        this.buffered -= 1;
        this.encodeQueueSize -= 1;
        this.outputs += 1;
        this.onOutput();
        this.emitDequeue();
      }
      // else: held in lookahead. No dequeue, no output. This is the trap.
    }, 1);
  }

  async flush() {
    // Drain the lookahead buffer at end of stream.
    while (this.buffered > 0) {
      this.buffered -= 1;
      this.encodeQueueSize -= 1;
      this.outputs += 1;
      this.onOutput();
    }
    this.emitDequeue();
  }
  close() { this.closed = true; }
  get outputCount() { return this.outputs; }
}

// --- OLD waitForQueue: no abort, no deadline -------------------------------
function waitForQueueOld(enc: MockVideoEncoder, limit: number): Promise<void> {
  if (enc.encodeQueueSize < limit) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onDequeue = () => {
      if (enc.encodeQueueSize < limit) { enc.removeEventListener('dequeue', onDequeue); resolve(); }
    };
    enc.addEventListener('dequeue', onDequeue);
  });
}

// --- NEW waitForQueue: abortable + deadlined -------------------------------
function waitForQueueNew(enc: MockVideoEncoder, limit: number, deadlineMs: number): Promise<void> {
  if (enc.encodeQueueSize < limit) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      enc.removeEventListener('dequeue', onDequeue);
      reject(new Error(`encoder stalled: queue stuck at ${enc.encodeQueueSize} for ${deadlineMs}ms`));
    }, deadlineMs);
    const onDequeue = () => {
      if (enc.encodeQueueSize < limit) {
        clearTimeout(timer);
        enc.removeEventListener('dequeue', onDequeue);
        resolve();
      }
    };
    enc.addEventListener('dequeue', onDequeue);
  });
}

async function runExport(opts: {
  label: string; lagInFrames: number; limit: number;
  waiter: 'old' | 'new'; totalFrames: number; timeoutMs: number;
}): Promise<string> {
  let outputs = 0;
  const enc = new MockVideoEncoder(opts.lagInFrames, () => { outputs++; });
  let submitted = 0;

  const loop = (async () => {
    for (let i = 0; i < opts.totalFrames; i++) {
      enc.encode();
      submitted++;
      if (enc.encodeQueueSize >= opts.limit) {
        if (opts.waiter === 'old') await waitForQueueOld(enc, opts.limit);
        else await waitForQueueNew(enc, opts.limit, 2000);
      }
    }
    await enc.flush();
    return `COMPLETED — submitted ${submitted}/${opts.totalFrames}, encoded ${enc.outputCount}`;
  })();

  const guard = new Promise<string>((resolve) =>
    setTimeout(() => resolve(`DEADLOCK — stuck after submitting ${submitted}/${opts.totalFrames}, encoded ${outputs}`), opts.timeoutMs));

  try { return await Promise.race([loop, guard]); }
  catch (e) { return `FAILED FAST — ${(e as Error).message} (submitted ${submitted})`; }
  finally { enc.close(); }
}

(async () => {
  const cases = [
    { label: "SHIPPED 7.7c: quality(lag=25) + limit 4 + old waiter", lagInFrames: 25, limit: 4, waiter: 'old' as const },
    { label: "STAGE 1 A: realtime(lag=0) + limit 4 + new waiter   ", lagInFrames: 0, limit: 4, waiter: 'new' as const },
    { label: "STAGE 1 B: quality(lag=25) + limit 4 + new waiter   ", lagInFrames: 25, limit: 4, waiter: 'new' as const },
    { label: "control  : quality(lag=25) + limit 64 + new waiter  ", lagInFrames: 25, limit: 64, waiter: 'new' as const },
  ];
  console.log('Export loop control-flow reproduction (150 frames)\n');
  for (const c of cases) {
    const r = await runExport({ ...c, totalFrames: 150, timeoutMs: 3000 });
    console.log(`${c.label}\n    -> ${r}\n`);
  }
})();
