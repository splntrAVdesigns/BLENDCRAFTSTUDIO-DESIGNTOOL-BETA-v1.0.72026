// Models a main-thread encoder that can ONLY make progress when the event loop
// is yielded to — the actual behavior of software VP9 in Chrome.
class MainThreadEncoder {
  encodeQueueSize = 0;
  state = 'configured';
  private pending = 0;
  outputs = 0;
  // Progress happens only in macrotasks — i.e. only if someone yields.
  private tick = () => {
    if (this.pending > 0) { this.pending--; this.encodeQueueSize--; this.outputs++; }
    this.timer = setTimeout(this.tick, 0);
  };
  private timer: any = setTimeout(this.tick, 0);
  encode() { this.pending++; this.encodeQueueSize++; }
  stop() { clearTimeout(this.timer); }
}
const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

// BROKEN (7.7c): waits on a dequeue event, never yields.
async function brokenLoop(total: number, timeoutMs: number) {
  const enc = new MainThreadEncoder();
  const start = Date.now();
  let submitted = 0;
  const run = (async () => {
    for (let i = 0; i < total; i++) {
      enc.encode(); submitted++;
      if (enc.encodeQueueSize >= 4) {
        // simulate awaiting an event that requires encoder progress,
        // while never yielding a macrotask
        await Promise.resolve();
        while (enc.encodeQueueSize >= 4) { await Promise.resolve(); if (Date.now() - start > timeoutMs) throw new Error('STARVED'); }
      }
    }
  })();
  try { await run; enc.stop(); return `COMPLETED submitted=${submitted} encoded=${enc.outputs}`; }
  catch { enc.stop(); return `DEADLOCK submitted=${submitted} encoded=${enc.outputs}`; }
}

// FIXED (7.8): polls queue while yielding real macrotasks.
async function fixedLoop(total: number) {
  const enc = new MainThreadEncoder();
  const start = Date.now();
  let submitted = 0;
  for (let i = 0; i < total; i++) {
    enc.encode(); submitted++;
    let guard = 0;
    while (enc.encodeQueueSize > 16 && guard < 2000) { await yieldToBrowser(); guard++; }
    if (i % 30 === 29) await yieldToBrowser();
  }
  while (enc.encodeQueueSize > 0 && Date.now() - start < 5000) await yieldToBrowser();
  enc.stop();
  return `COMPLETED submitted=${submitted} encoded=${enc.outputs} in ${Date.now()-start}ms`;
}

(async () => {
  console.log('BROKEN (dequeue-wait, no yield):', await brokenLoop(150, 1500));
  console.log('FIXED  (poll + yieldToBrowser): ', await fixedLoop(150));
})();
