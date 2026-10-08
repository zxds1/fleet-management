import { RETRY_BASE_MS, RETRY_MAX_MS } from './policy';

/**
 * Retries the offline queue with exponential backoff + jitter. Without this a 5xx or a flaky connection would leave
 * writes stuck until the next network event or app launch. Pure (timers injected) so it is unit tested with fake time.
 */
export type DrainOutcome = 'EMPTY' | 'OFFLINE' | 'AUTH' | 'BUSY' | 'BACKOFF';
export interface SchedulerDeps {
  drain: () => Promise<{ stoppedBecause: DrainOutcome }>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  random?: () => number;
  baseMs?: number; maxMs?: number;
}
export class DrainScheduler {
  private attempt = 0; private handle: unknown = null; private stopped = false;
  constructor(private readonly d: SchedulerDeps) {}
  private set(fn: () => void, ms: number) { return (this.d.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms); }
  private clear(h: unknown) { (this.d.clearTimer ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>)))(h); }
  /** Delay before retry number `n` (0-based): base*2^n capped at max, then +/-25% jitter so a whole fleet doesn't retry in lockstep. */
  delayFor(n: number) { const base = this.d.baseMs ?? 5_000; const max = this.d.maxMs ?? 300_000; const raw = Math.min(max, base * 2 ** n); return Math.round(raw * (0.75 + 0.5 * (this.d.random ?? Math.random)())); }
  /** Call on app start, foreground, reconnect, and after every enqueue. Safe to call repeatedly. */
  async kick() {
    if (this.stopped) return; if (this.handle) { this.clear(this.handle); this.handle = null; }
    const r = await this.d.drain();
    if (this.stopped) return;
    if (r.stoppedBecause === 'EMPTY') { this.attempt = 0; return; }
    if (r.stoppedBecause === 'AUTH') return;            // retrying cannot help until the person logs in again
    if (r.stoppedBecause === 'BUSY') return;            // another drain is running and will schedule its own retry
    this.handle = this.set(() => { this.handle = null; void this.kick(); }, this.delayFor(this.attempt++));
  }
  /** Schedule a retry without draining now (the caller just drained and some writes are still waiting). */
  arm() { if (this.stopped || this.handle) return; this.handle = this.set(() => { this.handle = null; void this.kick(); }, this.delayFor(this.attempt++)); }
  stop() { this.stopped = true; if (this.handle) this.clear(this.handle); this.handle = null; }
  /** Test/inspection helpers. */
  get retries() { return this.attempt; } get scheduled() { return this.handle !== null; }
}
