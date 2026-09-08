/** Request ownership and bounded waits. Termination releases the entire codec realm. */
export class ExportWorkerClient {
  private nextId = 0;
  private stopped = false;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private worker: Worker;
  private signal?: AbortSignal;
  constructor(worker: Worker, signal?: AbortSignal, onEvent?: (event: any) => void) {
    this.worker = worker;
    this.signal = signal;
    worker.onmessage = ({ data }) => {
      if (this.stopped) return;
      if (data.event) { onEvent?.(data); return; }
      const request = this.pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(data.id);
      if (data.error) this.stop(new Error(data.error), request);
      else request.resolve(data);
    };
    worker.onerror = event => this.stop(new Error(event.message || 'Export worker failed.'));
    worker.onmessageerror = () => this.stop(new Error('Export worker message could not be decoded.'));
    signal?.addEventListener('abort', this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  private abort = () => this.stop(new DOMException('Export cancelled.', 'AbortError'));
  request(message: object, transfer: Transferable[] = [], timeoutMs = 60_000): Promise<any> {
    if (this.stopped) return Promise.reject(new DOMException('Export job is no longer active.', 'AbortError'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new DOMException('Export encoder exceeded its 60-second operation deadline. The job was stopped safely.', 'TimeoutError')), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ ...message, id }, transfer); }
      catch (error) { this.stop(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  stop(error: Error = new DOMException('Export job closed.', 'AbortError'), detached?: { reject(error: Error): void }): void {
    if (this.stopped) return;
    this.stopped = true;
    this.signal?.removeEventListener('abort', this.abort);
    this.worker.terminate();
    detached?.reject(error);
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
  }
}
