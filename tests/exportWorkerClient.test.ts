import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportWorkerClient } from '../src/app/export/exportWorkerClient.ts';
class FakeWorker {
  onmessage: any; onerror: any; onmessageerror: any;
  messages: any[] = []; terminated = false;
  postMessage(message: any) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(data: any) { this.onmessage?.({ data }); }
}
test('waits for each acknowledgement and ignores duplicate or late responses', async () => {
  const worker = new FakeWorker(); let events = 0;
  const client = new ExportWorkerClient(worker as any, undefined, () => events++);
  const request = client.request({ type: 'frame' });
  worker.reply({ id: 999 }); worker.reply({ event: 'packet' });
  worker.reply({ id: worker.messages[0].id, ok: true });
  assert.equal((await request).ok, true); assert.equal(events, 1);
  client.stop(); worker.reply({ event: 'packet' });
  assert.equal(events, 1); assert.equal(worker.terminated, true);
});
test('abort terminates worker and rejects pending finish without waiting for flush', async () => {
  const worker = new FakeWorker(), abort = new AbortController();
  const client = new ExportWorkerClient(worker as any, abort.signal);
  const request = client.request({ type: 'finish' });
  abort.abort(); await assert.rejects(request, { name: 'AbortError' });
  assert.equal(worker.terminated, true);
});
test('operation deadline terminates stalled encoder before rejecting', async () => {
  const worker = new FakeWorker(); const client = new ExportWorkerClient(worker as any);
  await assert.rejects(client.request({ type: 'finish' }, [], 5), { name: 'TimeoutError' });
  assert.equal(worker.terminated, true);
});
test('worker failure rejects all outstanding work and destroys owner', async () => {
  const worker = new FakeWorker(); const client = new ExportWorkerClient(worker as any);
  const a = client.request({ type: 'frame' }), b = client.request({ type: 'finish' });
  const assertions = [assert.rejects(a, /codec failed/), assert.rejects(b, /codec failed/)];
  worker.reply({ id: worker.messages[0].id, error: 'codec failed' });
  await Promise.all(assertions); assert.equal(worker.terminated, true);
});
