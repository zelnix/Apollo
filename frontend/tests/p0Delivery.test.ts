import assert from "node:assert/strict";
import { test } from "node:test";

import { DeliveryQueue, type DeliveryQueueOptions } from "../src/store/deliveryQueue.ts";
import { shouldBypassSetup } from "../src/testing/setupBypass.ts";

type Payload = Record<string, unknown>;

function eventPayload(overrides: Partial<Payload> = {}): Payload {
  return {
    event_id: "evt-1",
    device_id: "dev-1",
    category: "connection",
    state: "barking",
    status: "active",
    verified_block: false,
    occurred_at: "2026-01-01T00:00:00Z",
    resolved_at: null,
    ...overrides,
  };
}

function ackFor(payload: Payload, overrides: Partial<Payload> = {}): Payload {
  return { ...payload, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildHarness() {
  let persisted: string | null = null;
  let now = 1_700_000_000_000;
  const states: { pending: number; blocked: number; overflow: number; error: string | null }[] = [];
  const sends: Payload[] = [];
  let failWrites = 0;
  let sender: (body: Payload) => Promise<Payload> = async (body) => ackFor(body);

  const io = {
    read: async () => persisted,
    write: async (value: string) => {
      if (failWrites > 0) {
        failWrites -= 1;
        throw new Error("write failed");
      }
      persisted = value;
    },
    send: async (body: Payload) => {
      sends.push(body);
      return sender(body);
    },
    changed: (status: { pending: number; blocked: number; overflow: number; error: string | null }) => {
      states.push(status);
    },
    now: () => now,
  };

  return {
    queue: (options?: DeliveryQueueOptions) => new DeliveryQueue(io, options),
    setSender: (fn: (body: Payload) => Promise<Payload>) => {
      sender = fn;
    },
    setFailWrites: (count: number) => {
      failWrites = count;
    },
    setNow: (ts: number) => {
      now = ts;
    },
    sends,
    states,
    getJournal: () => (persisted ? (JSON.parse(persisted) as Record<string, unknown>) : null),
  };
}

test("durable offline -> reload -> retry -> ack", async () => {
  const h = buildHarness();
  const p = eventPayload();
  let first = true;
  h.setSender(async (body) => {
    if (first) {
      first = false;
      const e = new Error("offline") as Error & { status?: number };
      e.status = 500;
      throw e;
    }
    return ackFor(body);
  });

  const q1 = h.queue();
  await q1.enqueue(p);
  await q1.flush("dev-1");
  const afterFail = h.getJournal() as any;
  assert.equal(Object.keys(afterFail.pending).length, 1);

  const q2 = h.queue();
  await q2.flush("dev-1", true);
  const done = h.getJournal() as any;
  assert.equal(Object.keys(done.pending).length, 0);
  assert.equal(Object.keys(done.receipts).length, 1);
});

test("backoff waits, manual flush bypasses delay", async () => {
  const h = buildHarness();
  const p = eventPayload();
  let failures = 0;
  h.setSender(async (body) => {
    if (failures < 1) {
      failures += 1;
      const e = new Error("server") as Error & { status?: number };
      e.status = 500;
      throw e;
    }
    return ackFor(body);
  });
  const q = h.queue();
  await q.enqueue(p);
  await q.flush("dev-1");
  const afterFail = h.getJournal() as any;
  const row = afterFail.pending["dev-1:evt-1"];
  assert.equal(row.attempts, 1);
  assert.ok(row.nextAt > h.sends.length);

  const callsAfterFail = h.sends.length;
  await q.flush("dev-1");
  assert.equal(h.sends.length, callsAfterFail);

  await q.flush("dev-1", true);
  const done = h.getJournal() as any;
  assert.equal(Object.keys(done.pending).length, 0);
});

test("EgressViolation/422 block delivery; 500 keeps retryable", async () => {
  const h = buildHarness();
  const q = h.queue();

  await q.enqueue(eventPayload({ event_id: "ev-egress" }));
  h.setSender(async () => {
    const e = new Error("privacy") as Error & { name?: string };
    e.name = "EgressViolation";
    throw e;
  });
  await q.flush("dev-1");
  let j = h.getJournal() as any;
  assert.equal(j.pending["dev-1:ev-egress"].blocked, true);

  await q.enqueue(eventPayload({ event_id: "ev-422" }));
  h.setSender(async () => {
    const e = new Error("unprocessable") as Error & { status?: number };
    e.status = 422;
    throw e;
  });
  await q.flush("dev-1");
  j = h.getJournal() as any;
  assert.equal(j.pending["dev-1:ev-422"].blocked, true);

  await q.enqueue(eventPayload({ event_id: "ev-500" }));
  h.setSender(async () => {
    const e = new Error("boom") as Error & { status?: number };
    e.status = 500;
    throw e;
  });
  await q.flush("dev-1");
  j = h.getJournal() as any;
  assert.equal(j.pending["dev-1:ev-500"].blocked, false);
});

test("ack mismatch keeps pending; ISO Z/+00:00 are equivalent", async () => {
  const h = buildHarness();
  const q = h.queue();

  const mismatch = eventPayload({ event_id: "ev-mismatch", status: "resolved", resolved_at: "2026-01-01T00:00:00Z" });
  await q.enqueue(mismatch);
  h.setSender(async (body) => ackFor(body, { status: "active" }));
  await q.flush("dev-1");
  let j = h.getJournal() as any;
  assert.equal(Object.keys(j.pending).includes("dev-1:ev-mismatch"), true);

  const iso = eventPayload({ event_id: "ev-iso", status: "resolved", resolved_at: "2026-01-01T00:00:00Z" });
  await q.enqueue(iso);
  h.setSender(async (body) => ackFor(body, { resolved_at: "2026-01-01T00:00:00+00:00" }));
  await q.flush("dev-1", true);
  j = h.getJournal() as any;
  assert.equal(Object.keys(j.pending).includes("dev-1:ev-iso"), false);
});

test("updated version while old request in flight stays pending", async () => {
  const h = buildHarness();
  const q = h.queue();
  const gate = deferred<Payload>();
  let calls = 0;
  h.setSender(async (body) => {
    calls += 1;
    if (calls === 1) return gate.promise;
    return ackFor(body);
  });

  const v1 = eventPayload({ event_id: "ev-race", status: "active" });
  const v2 = eventPayload({ event_id: "ev-race", status: "resolved", resolved_at: "2026-01-02T00:00:00Z" });
  await q.enqueue(v1);
  const flushing = q.flush("dev-1");
  await Promise.resolve();
  await q.enqueue(v2);
  gate.resolve(ackFor(v1));
  await flushing;

  const afterOldAck = h.getJournal() as any;
  assert.equal(afterOldAck.pending["dev-1:ev-race"].payload.status, "resolved");

  await q.flush("dev-1", true);
  const done = h.getJournal() as any;
  assert.equal(Object.keys(done.pending).includes("dev-1:ev-race"), false);
});

test("reverting to an older acknowledged version cannot replace newer pending", async () => {
  const h = buildHarness();
  const q = h.queue();
  const v1 = eventPayload({ event_id: "ev-version", status: "active" });
  const v2 = eventPayload({ event_id: "ev-version", status: "resolved", resolved_at: "2026-01-02T00:00:00Z" });

  h.setSender(async (body) => ackFor(body));
  await q.enqueue(v1);
  await q.flush("dev-1");

  h.setSender(async () => {
    const e = new Error("busy") as Error & { status?: number };
    e.status = 500;
    throw e;
  });
  await q.enqueue(v2);
  await q.flush("dev-1");

  await q.enqueue(v1);
  const j = h.getJournal() as any;
  assert.equal(j.pending["dev-1:ev-version"].payload.status, "resolved");
});

test("queue overflow is bounded, reported, and never evicts pending evidence", async () => {
  const h = buildHarness();
  const q = h.queue({ maxPending: 2, maxReceipts: 4, receiptTtlMs: 60_000 });
  await q.enqueue(eventPayload({ event_id: "ev-1" }));
  await q.enqueue(eventPayload({ event_id: "ev-2" }));
  await assert.rejects(() => q.enqueue(eventPayload({ event_id: "ev-3" })), { name: "DeliveryQueueOverflow" });
  let j = h.getJournal() as any;
  assert.deepEqual(Object.keys(j.pending).sort(), ["dev-1:ev-1", "dev-1:ev-2"]);
  assert.equal(h.states.at(-1)?.overflow, 1);
  assert.match(h.states.at(-1)?.error ?? "", /No pending evidence was kept|Pending evidence was kept|capacity/i);
  await q.flush("dev-1", true);
  await q.enqueue(eventPayload({ event_id: "ev-3" }));
  j = h.getJournal() as any;
  assert.ok(j.pending["dev-1:ev-3"]);
  assert.equal(h.states.at(-1)?.overflow, 0);
});

test("receipt history is bounded and expires by retention policy", async () => {
  const h = buildHarness();
  const q = h.queue({ maxPending: 4, maxReceipts: 2, receiptTtlMs: 100 });
  for (let i = 1; i <= 3; i += 1) {
    h.setNow(1_700_000_000_000 + i * 10);
    await q.enqueue(eventPayload({ event_id: `receipt-${i}` }));
    await q.flush("dev-1", true);
  }
  let j = h.getJournal() as any;
  assert.equal(Object.keys(j.receipts).length, 2);
  h.setNow(1_700_000_000_500);
  await q.enqueue(eventPayload({ event_id: "receipt-4" }));
  j = h.getJournal() as any;
  assert.equal(Object.keys(j.receipts).length, 0);
});

test("setup bypass is explicit, preview-web-only, and never available in production/native", () => {
  const url = "https://apollo.preview.example/message?__apollo_test_setup=1";
  assert.equal(shouldBypassSetup("web", true, url), true);
  assert.equal(shouldBypassSetup("web", false, url), false);
  assert.equal(shouldBypassSetup("android", true, url), false);
  assert.equal(shouldBypassSetup("ios", true, url), false);
  assert.equal(shouldBypassSetup("web", true, "https://apollo.preview.example/message"), false);
});

test("enqueue write failure and ack write failure retain pending with visible error", async () => {
  const h = buildHarness();
  const q = h.queue();

  h.setFailWrites(1);
  await assert.rejects(() => q.enqueue(eventPayload({ event_id: "ev-write-enqueue" })));

  await q.enqueue(eventPayload({ event_id: "ev-write-ack" }));
  h.setSender(async (body) => ackFor(body));
  h.setFailWrites(1);
  await q.flush("dev-1");

  const j = h.getJournal() as any;
  assert.equal(Object.keys(j.pending).includes("dev-1:ev-write-ack"), true);
  assert.match(j.pending["dev-1:ev-write-ack"].error, /Delivery not acknowledged/i);
});

test("restart publishes blocked status and duplicate replay sends once", async () => {
  const h = buildHarness();
  const q = h.queue();
  await q.enqueue(eventPayload({ event_id: "ev-dup" }));
  await q.enqueue(eventPayload({ event_id: "ev-dup" }));
  await q.flush("dev-1");
  assert.equal(h.sends.filter((x) => x.event_id === "ev-dup").length, 1);

  const seed = {
    pending: {
      "dev-1:ev-blocked": {
        payload: eventPayload({ event_id: "ev-blocked" }),
        version: JSON.stringify(eventPayload({ event_id: "ev-blocked" })),
        attempts: 1,
        nextAt: Date.now() + 100_000,
        error: "blocked",
        blocked: true,
      },
    },
    receipts: {},
  };
  const h2 = buildHarness();
  (h2 as any).setFailWrites(0);
  // Seed by replaying through queue storage contract.
  const q2 = h2.queue();
  await (q2 as any)["io"].write(JSON.stringify(seed));
  await q2.flush("dev-1");
  assert.ok(h2.states.some((s) => s.blocked >= 1));
});

test("cross-device isolation, pauseForClear tombstones, resume/restart never reuploads cleared", async () => {
  const h = buildHarness();
  const q = h.queue();
  const active = deferred<Payload>();
  let activeCall = 0;
  h.setSender(async (body) => {
    activeCall += 1;
    if (activeCall === 1) return active.promise;
    return ackFor(body);
  });

  await q.enqueue(eventPayload({ event_id: "ev-a", device_id: "dev-a" }));
  await q.enqueue(eventPayload({ event_id: "ev-b", device_id: "dev-b" }));
  const flushing = q.flush("dev-a");
  await Promise.resolve();

  let pausedDone = false;
  const pause = q.pauseForClear("dev-a").then(() => {
    pausedDone = true;
  });
  await Promise.resolve();
  assert.equal(pausedDone, false);

  active.resolve(ackFor(eventPayload({ event_id: "ev-a", device_id: "dev-a" })));
  await flushing;
  await pause;
  assert.equal(pausedDone, true);

  await q.clearPaused("dev-a", ["ev-a"]);
  const afterClear = h.getJournal() as any;
  assert.equal(afterClear.receipts["dev-a:ev-a"], undefined);
  assert.equal(afterClear.cleared["dev-a:ev-a"], true);
  assert.equal(afterClear.pending["dev-a:ev-a"], undefined);
  assert.ok(afterClear.pending["dev-b:ev-b"]);

  q.resume("dev-a");
  const qReload = h.queue();
  await qReload.enqueue(eventPayload({ event_id: "ev-a", device_id: "dev-a" }));
  const before = h.sends.length;
  await qReload.flush("dev-a", true);
  assert.equal(h.sends.length, before);
});
