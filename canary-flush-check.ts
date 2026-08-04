// Verify the flush()-based canary logic across three scenarios a real
// WebCodecs implementation could produce.
class MockEncoder {
  state: 'configured' | 'closed' = 'configured';
  private outputCount = 0;
  constructor(
    private behavior: 'healthy-dequeue-silent' | 'stalls-forever' | 'errors-during-flush',
    private onOutput: () => void,
  ) {}
  encode() { /* queued, output arrives on flush for this mock */ }
  async flush(): Promise<void> {
    if (this.behavior === 'stalls-forever') {
      return new Promise(() => {}); // never resolves — simulates a truly dead encoder
    }
    if (this.behavior === 'errors-during-flush') {
      throw new Error('mock encoder failure during flush');
    }
    // healthy-dequeue-silent: never fired 'dequeue' (that's the whole point of
    // the old bug), but DOES deliver output + resolve on flush.
    await new Promise((r) => setTimeout(r, 10));
    this.onOutput(); this.onOutput();
  }
  close() { this.state = 'closed'; }
}

async function runCanary(behavior: Parameters<typeof MockEncoder.prototype['flush']> extends [] ? never : any, timeoutMs: number) {
  let outputCount = 0;
  let flushResolved = false;
  let settledError: string | undefined;
  const enc = new MockEncoder(behavior, () => { outputCount++; });
  enc.encode(); enc.encode();
  const flushPromise = enc.flush().then(() => { flushResolved = true; }).catch((e) => { settledError = String(e.message ?? e); });
  const start = Date.now();
  await Promise.race([flushPromise, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  enc.close();
  const ok = flushResolved && outputCount >= 1 && !settledError;
  return { ok, outputCount, flushResolved, settledError, elapsedMs: Date.now() - start };
}

(async () => {
  console.log('healthy (flush delivers output, no dequeue needed):', await runCanary('healthy-dequeue-silent', 6000));
  console.log('stalls forever (flush never resolves):             ', await runCanary('stalls-forever', 1000));
  console.log('errors during flush:                                ', await runCanary('errors-during-flush', 1000));
})();
