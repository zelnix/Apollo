// Full Gemini narration with authenticated retrieval, cancellation fencing and temporary playback copies.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioSource } from 'expo-audio';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { API_BASE, apiDelete, apiPost } from '@/src/api/client';
import { getDeviceToken } from '@/src/auth/deviceIdentity';
import { storage } from '@/src/utils/storage';
import { speechSegments } from './segments';

const K_AUTO = 'apollo.voice.auto';
let player: AudioPlayer | null = null;
let speaking: string | null = null;
let generation = 0;
let objectUrl: string | null = null;
let scopeId: string | null = null;
let playbackError: string | null = null;
let errorForText: string | null = null;
let expires: ReturnType<typeof setTimeout> | null = null;
let queue: { texts: string[]; index: number; deviceId: string; token: number; scope: string } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

function releaseUrl() { if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; } }
export function stopHiggins() {
  generation++; queue = null; speaking = null; playbackError = null; errorForText = null;
  try { player?.pause(); player?.replace(null); } catch { /* no loaded playback */ }
  releaseUrl();
  if (expires) clearTimeout(expires); expires = null;
  if (scopeId) void apiDelete(`/voice/sessions/${scopeId}`).catch(() => undefined);
  scopeId = null; notify();
}

function getPlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(null);
    player.addListener('playbackStatusUpdate', status => {
      if (queue && status.didJustFinish) void advance();
    });
  }
  return player;
}

async function playSegment(q: NonNullable<typeof queue>) {
  const { url } = await apiPost<{ url: string }>('/voice/speak', 'voice', {
    device_id: q.deviceId, scope_id: q.scope, text: q.texts[q.index],
  });
  if (q.token !== generation || queue !== q) return;
  const token = await getDeviceToken();
  if (!token) throw new Error('Apollo needs its device credential to play protected audio.');
  const uri = `${API_BASE.replace(/\/api$/, '')}${url}`;
  let source: AudioSource = { uri, headers: { Authorization: `Bearer ${token}` } };
  if (Platform.OS === 'web') {
    const response = await fetch(uri, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) throw new Error('This temporary audio is unavailable or expired.');
    const blob = await response.blob();
    if (q.token !== generation || queue !== q) return;
    releaseUrl(); objectUrl = URL.createObjectURL(blob); source = { uri: objectUrl };
  }
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
  if (q.token !== generation || queue !== q) return;
  const p = getPlayer(); p.replace(source); p.play(); notify();
}

async function advance() {
  const q = queue;
  if (!q) return;
  q.index++;
  if (q.index >= q.texts.length) { stopHiggins(); return; }
  notify();
  try { await playSegment(q); } catch {
    if (q.token !== generation) return;
    const interruptedText = speaking;
    stopHiggins(); errorForText = interruptedText; playbackError = 'Narration stopped before all sections were read. The full text remains available.'; notify();
  }
}

export async function speakHigginsSteps(texts: string[], deviceId: string | null): Promise<void> {
  if (!deviceId) throw new Error('Apollo is not registered yet.');
  const segments = texts.flatMap(text => speechSegments(text));
  if (!segments.length) return;
  stopHiggins(); scopeId = Crypto.randomUUID(); speaking = texts.join('\n').trim();
  const q = { texts: segments, index: 0, deviceId, token: generation, scope: scopeId };
  queue = q; expires = setTimeout(stopHiggins, 15 * 60 * 1000); notify();
  try { await playSegment(q); } catch (error) { if (q.token === generation) stopHiggins(); throw error; }
}

export function speakHiggins(text: string, deviceId: string | null) { return speakHigginsSteps([text], deviceId); }
export function useHigginsReader(deviceId: string | null) {
  const [, render] = useState(0); const [busy, setBusy] = useState(false);
  useEffect(() => { const listener = () => render(value => value + 1); listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  const read = useCallback(async (texts: string[]) => { setBusy(true); try { await speakHigginsSteps(texts, deviceId); } finally { setBusy(false); } }, [deviceId]);
  return { read, stop: stopHiggins, progress: queue ? { index: queue.index, total: queue.texts.length } : null, busy, error: playbackError };
}
export function useHiggins(deviceId: string | null) {
  const reader = useHigginsReader(deviceId);
  const speak = useCallback(async (text: string) => { if (speaking === text.trim()) stopHiggins(); else await reader.read([text]); }, [reader.read]); // eslint-disable-line react-hooks/exhaustive-deps
  return { speak, stop: stopHiggins, speaking, busy: reader.busy, error: reader.error, errorForText };
}
export async function getHigginsAuto(): Promise<boolean> { return storage.getItem<boolean>(K_AUTO, false).then(Boolean); }
export async function setHigginsAuto(on: boolean): Promise<void> { await storage.setItem(K_AUTO, on); }