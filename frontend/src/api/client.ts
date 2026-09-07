// Thin API client. Every outbound body passes through the egress policy.

import { getDeviceToken, resetDeviceIdentity } from "@/src/auth/deviceIdentity";
import { enforceEgress, type EgressEndpoint } from "@/src/domain/privacy";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
if (!BASE) throw new Error("EXPO_PUBLIC_BACKEND_URL is not set");
export const API_BASE = `${BASE}/api`;

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ApiError"; }
}

/** Bearer credential for every call. Fails closed: with no identity the request is not sent. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getDeviceToken();
  if (!token) throw new ApiError(401, "Apollo hasn't registered this device yet.");
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...auth, ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* keep statusText */ }
    if (res.status === 401) await resetDeviceIdentity(typeof detail === "string" ? detail : "Device credential rejected.");
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string) { return request<T>(path); }
export function apiDelete<T>(path: string) { return request<T>(path, { method: "DELETE" }); }
export function apiPost<T>(path: string, endpoint: EgressEndpoint, body: Record<string, unknown>) {
  return request<T>(path, { method: "POST", body: JSON.stringify(enforceEgress(endpoint, body)) });
}
export function apiPatch<T>(path: string, body: Record<string, unknown>) {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}
export function apiPut<T>(path: string, endpoint: EgressEndpoint, body: Record<string, unknown>) {
  return request<T>(path, { method: "PUT", body: JSON.stringify(enforceEgress(endpoint, body)) });
}

/** SSE streaming over XHR — works on native and web without ReadableStream. */
export function streamPost(path: string, endpoint: EgressEndpoint, body: Record<string, unknown>, onDelta: (t: string) => void, onDone: (err?: string) => void) {
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let finished = false;
  const finish = (err?: string) => { if (!finished) { finished = true; onDone(err); } };
  xhr.open("POST", `${API_BASE}${path}`);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Accept", "text/event-stream");
  void getDeviceToken().then((token) => {
    if (!token) { finish("Apollo hasn't registered this device yet."); return; }
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(JSON.stringify(enforceEgress(endpoint, body)));
  });
  const consume = () => {
    const text = xhr.responseText ?? "";
    const chunk = text.slice(seen);
    const lastBreak = chunk.lastIndexOf("\n\n");
    if (lastBreak < 0) return;
    seen += lastBreak + 2;
    for (const line of chunk.slice(0, lastBreak).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const evt = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; error?: string };
        if (evt.delta) onDelta(evt.delta);
        if (evt.error) finish(evt.error);
        if (evt.done) finish();
      } catch { /* partial line */ }
    }
  };
  xhr.onprogress = consume;
  xhr.onload = () => { consume(); if (xhr.status === 401) { void resetDeviceIdentity("Device credential rejected."); finish("Apollo needs to re-register this device. Try again in a moment."); } else if (xhr.status >= 400) finish("Apollo could not answer right now."); else finish(); };
  xhr.onerror = () => finish("Connection problem. Try again.");
  xhr.ontimeout = () => finish("That took too long. Try again.");
  xhr.timeout = 60000;
  return () => xhr.abort();
}
