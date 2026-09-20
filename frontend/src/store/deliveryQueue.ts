// Durable single-writer outbox. Storage failure is an error, never an acknowledgement.
type Payload = Record<string, unknown>;
type Item = { payload: Payload; version: string; attempts: number; nextAt: number; error: string | null; blocked: boolean };
type Journal = { pending: Record<string, Item>; receipts: Record<string, string>; cleared?: Record<string, true> };
type IO = { read(): Promise<string | null>; write(value: string): Promise<void>; send(body: Payload): Promise<Payload>; changed(status: DeliveryStatus): void; now?: () => number };
export type DeliveryStatus = { pending: number; blocked: number; error: string | null };
export class DeliveryQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private running = false;
  private journal: Journal | null = null;
  private io: IO;
  private paused = new Set<string>();
  private activeSend: Promise<Payload> | null = null;
  constructor(io: IO) { this.io = io; }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn); this.chain = next.catch(() => undefined); return next;
  }
  private async load() {
    if (!this.journal) {
      const raw = await this.io.read(); this.journal = raw ? JSON.parse(raw) : { pending: {}, receipts: {} };
      if (!this.journal?.pending || !this.journal.receipts) { this.journal = null; throw new Error('Delivery journal is unreadable'); }
      this.publish(this.journal);
    }
    return this.journal;
  }
  private async save(j: Journal) {
    try { await this.io.write(JSON.stringify(j)); }
    catch (error) { this.journal = null; throw error; } // reload durable state; never keep an unpersisted receipt
    this.publish(j);
  }
  private publish(j: Journal) {
    const rows = Object.values(j.pending);
    this.io.changed({ pending: rows.length, blocked: rows.filter(x => x.blocked).length, error: rows.find(x => x.error)?.error ?? null });
  }
  async enqueue(payload: Payload) {
    return this.serial(async () => {
      if (this.paused.has(String(payload.device_id))) return;
      const j = await this.load(), key = `${payload.device_id}:${payload.event_id}`, version = JSON.stringify(payload);
      if (j.cleared?.[key]) return;
      // A receipt is a durable acknowledgement for this exact version. Never let replaying that
      // older version replace a different, newer version which is still pending delivery.
      if (j.receipts[key] === version || j.pending[key]?.version === version) return;
      j.pending[key] = { payload, version, attempts: 0, nextAt: 0, error: null, blocked: false };
      await this.save(j);
    });
  }
  async flush(deviceId: string, manual = false) {
    if (this.running) return;
    this.running = true;
    try {
      const entries = await this.serial(async () => Object.entries((await this.load()).pending));
      for (const [key, item] of entries) {
        if (this.paused.has(deviceId) || item.payload.device_id !== deviceId || (!manual && (item.blocked || item.nextAt > (this.io.now?.() ?? Date.now())))) continue;
        try {
          this.activeSend = this.io.send(item.payload);
          const ack = await this.activeSend;
          if (ack.event_id !== item.payload.event_id || ack.device_id !== deviceId || ack.state !== item.payload.state || ack.verified_block !== item.payload.verified_block ||
            ack.status !== item.payload.status || !sameTime(ack.resolved_at, item.payload.resolved_at) ||
            (item.payload.enforcement_evidence && (ack.enforcement_evidence as Payload)?.evidence_id !== (item.payload.enforcement_evidence as Payload).evidence_id)) throw new Error('Server acknowledgement did not match the event');
          await this.serial(async () => {
            const j = await this.load();
            if (j.pending[key]?.version !== item.version) return;
            j.receipts[key] = item.version; delete j.pending[key]; await this.save(j);
          });
        } catch (error) {
          await this.serial(async () => {
            const j = await this.load(); if (j.pending[key]?.version !== item.version) return;
            const e = error as { name?: string; status?: number };
            item.blocked = e.name === 'EgressViolation' || (!!e.status && e.status >= 400 && e.status < 500 && e.status !== 429);
            item.attempts += 1; item.nextAt = (this.io.now?.() ?? Date.now()) + Math.min(300_000, 2000 * 2 ** Math.min(item.attempts, 7));
            item.error = item.blocked ? 'Delivery blocked by policy or server validation. The event remains on this phone.' : 'Delivery not acknowledged. Apollo will retry.';
            j.pending[key] = item;
            await this.save(j);
          });
        } finally { this.activeSend = null; }
      }
    } finally { this.running = false; }
  }
  async pauseForClear(deviceId: string) {
    this.paused.add(deviceId);
    try { await this.activeSend; } catch { /* caller will reconcile after clear failure */ }
  }
  async clearPaused(deviceId: string, eventIds: string[]) {
    await this.serial(async () => {
      const j = await this.load();
      j.cleared ??= {};
      for (const id of eventIds) j.cleared[`${deviceId}:${id}`] = true;
      for (const [key, item] of Object.entries(j.pending)) if (item.payload.device_id === deviceId) j.cleared[key] = true;
      for (const key of Object.keys(j.pending)) if (j.pending[key].payload.device_id === deviceId) delete j.pending[key];
      // A tombstone records an explicit clear, NEVER a delivery acknowledgement.
      await this.save(j);
    });
  }
  resume(deviceId: string) { this.paused.delete(deviceId); }
}
function sameTime(a: unknown, b: unknown) {
  return a == null && b == null || typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b);
}