import type { BenchmarkProgressEvent } from './types.js';

export class BenchmarkStream {
  private eventSource: EventSource | null = null;
  private listeners: Set<(event: BenchmarkProgressEvent) => void> = new Set();

  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  connect(jobId: string): void {
    if (this.eventSource) this.disconnect();
    const url = new URL(`${this.baseUrl}/v1/benchmarks/stream/${jobId}`);
    url.searchParams.set('apiKey', this.apiKey);
    this.eventSource = new EventSource(url.toString());
    this.eventSource.addEventListener('progress', (e: MessageEvent) => {
      try { const event = JSON.parse(e.data) as BenchmarkProgressEvent; this.listeners.forEach((l) => l(event)); } catch {}
    });
    this.eventSource.addEventListener('complete', (e: MessageEvent) => {
      try { const event = JSON.parse(e.data) as BenchmarkProgressEvent; this.listeners.forEach((l) => l(event)); } catch {}
      this.disconnect();
    });
  }

  subscribe(listener: (event: BenchmarkProgressEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect(): void { this.eventSource?.close(); this.eventSource = null; }
}
