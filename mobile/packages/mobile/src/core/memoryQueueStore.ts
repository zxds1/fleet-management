import type { QueuedWrite, QueueStatus, QueueStore } from './offlineQueue';
export class MemoryQueueStore implements QueueStore {
  private rows = new Map<number, QueuedWrite>();
  private seq = 0;
  private refs: Record<string, string> = {};
  async insert(w: Omit<QueuedWrite, 'id'>) { const id = ++this.seq; this.rows.set(id, { ...w, id }); return id; }
  async get(id: number) { const r = this.rows.get(id); return r ? { ...r } : null; }
  async list(s: QueueStatus[]) { return [...this.rows.values()].filter((r) => s.includes(r.status)).sort((a, b) => a.id - b.id).map((r) => ({ ...r })); }
  async update(id: number, p: Partial<Omit<QueuedWrite, 'id'>>) { const r = this.rows.get(id); if (r) this.rows.set(id, { ...r, ...p }); }
  async remove(id: number) { this.rows.delete(id); }
  async clear() { this.rows.clear(); this.refs = {}; }
  async getRefs() { return { ...this.refs }; }
  async setRef(t: string, v: string) { this.refs[t] = v; }
}
