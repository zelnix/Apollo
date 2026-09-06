// Higgins' voice — Apollo's handler reads alerts and answers aloud. One module-level player so narration never
// overlaps; text goes to the backend (which sends only the words already on screen to the TTS provider) and the
// mp3 URL comes back from our own cache. Never uses the robotic on-device voice.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useCallback, useEffect, useState } from "react";

import { API_BASE, apiPost } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

const K_AUTO = "apollo.voice.auto";
let player: AudioPlayer | null = null;
let current: string | null = null;
/** Step-by-step reading: remaining texts + index of the one playing (null when not reading a sequence). */
let queue: { texts: string[]; index: number; deviceId: string | null; token: number } | null = null;
let seqToken = 0;
const listeners = new Set<(speaking: string | null) => void>();
const notify = () => listeners.forEach((l) => l(current));
const seqListeners = new Set<(p: { index: number; total: number } | null) => void>();
const notifySeq = () => seqListeners.forEach((l) => l(queue ? { index: queue.index, total: queue.texts.length } : null));

function getPlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(null);
    player.addListener("playbackStatusUpdate", (st) => {
      if (current && st.isLoaded && !st.playing && st.duration > 0 && st.currentTime >= st.duration - 0.1) {
        current = null; notify();
        if (queue) void advance();
      }
    });
  }
  return player;
}

export function stopHiggins() { queue = null; seqToken += 1; notifySeq(); if (player) { try { player.pause(); } catch { /* not loaded */ } } current = null; notify(); }

async function fetchUrl(text: string, deviceId: string | null): Promise<string> {
  const { url } = await apiPost<{ url: string }>("/voice/speak", "voice", { device_id: deviceId ?? "local-device", text });
  return `${API_BASE.replace(/\/api$/, "")}${url}`;
}

async function playUrl(uri: string, text: string) {
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
  const p = getPlayer();
  p.replace({ uri });
  p.play();
  current = text; notify();
}

async function advance() {
  if (!queue) return;
  const q = queue;
  const next = q.index + 1;
  if (next >= q.texts.length) { queue = null; notifySeq(); return; }
  q.index = next; notifySeq();
  try {
    const uri = await fetchUrl(q.texts[next], q.deviceId);
    if (queue !== q || q.token !== seqToken) return; // stopped meanwhile
    await playUrl(uri, q.texts[next]);
    if (next + 1 < q.texts.length) void fetchUrl(q.texts[next + 1], q.deviceId).catch(() => undefined); // warm the cache
  } catch { queue = null; notifySeq(); }
}

/** Read several chunks in order (event or incident narration). Resolves when the first chunk starts playing. */
export async function speakHigginsSteps(texts: string[], deviceId: string | null): Promise<void> {
  const clean = texts.map((t) => t.trim().slice(0, 1500)).filter(Boolean);
  if (!clean.length) return;
  stopHiggins();
  const token = seqToken;
  const q = { texts: clean, index: 0, deviceId, token };
  const uri = await fetchUrl(clean[0], deviceId);
  if (token !== seqToken) return;
  queue = q; notifySeq();
  await playUrl(uri, clean[0]);
  if (clean.length > 1) void fetchUrl(clean[1], deviceId).catch(() => undefined);
}

/** React glue for step-by-step reading: progress is {index,total} while reading, null otherwise. */
export function useHigginsReader(deviceId: string | null) {
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(queue ? { index: queue.index, total: queue.texts.length } : null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { seqListeners.add(setProgress); return () => { seqListeners.delete(setProgress); }; }, []);
  const read = useCallback(async (texts: string[]) => { setBusy(true); try { await speakHigginsSteps(texts, deviceId); } finally { setBusy(false); } }, [deviceId]);
  return { read, stop: stopHiggins, progress, busy };
}

/** Speak `text` (≤1500 chars). Resolves once playback has started; throws with a friendly message otherwise. */
export async function speakHiggins(text: string, deviceId: string | null): Promise<void> {
  const clean = text.trim().slice(0, 1500);
  if (!clean) return;
  stopHiggins();
  const uri = await fetchUrl(clean, deviceId);
  await playUrl(uri, clean);
}

export async function getHigginsAuto(): Promise<boolean> { return storage.getItem<boolean>(K_AUTO, false).then((v) => !!v); }
export async function setHigginsAuto(on: boolean): Promise<void> { await storage.setItem(K_AUTO, on); }

/** React glue: `speaking` is the text currently being read (null when silent). */
export function useHiggins(deviceId: string | null) {
  const [speaking, setSpeaking] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listeners.add(setSpeaking); return () => { listeners.delete(setSpeaking); }; }, []);
  const speak = useCallback(async (text: string) => {
    if (current && current === text.trim().slice(0, 1500)) { stopHiggins(); return; }
    setBusy(true);
    try { await speakHiggins(text, deviceId); } finally { setBusy(false); }
  }, [deviceId]);
  return { speak, stop: stopHiggins, speaking, busy };
}
