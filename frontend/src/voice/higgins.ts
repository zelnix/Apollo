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
const listeners = new Set<(speaking: string | null) => void>();
const notify = () => listeners.forEach((l) => l(current));

function getPlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(null);
    player.addListener("playbackStatusUpdate", (st) => { if (current && st.isLoaded && !st.playing && st.duration > 0 && st.currentTime >= st.duration - 0.1) { current = null; notify(); } });
  }
  return player;
}

export function stopHiggins() { if (player) { try { player.pause(); } catch { /* not loaded */ } } current = null; notify(); }

/** Speak `text` (≤1500 chars). Resolves once playback has started; throws with a friendly message otherwise. */
export async function speakHiggins(text: string, deviceId: string | null): Promise<void> {
  const clean = text.trim().slice(0, 1500);
  if (!clean) return;
  stopHiggins();
  const { url } = await apiPost<{ url: string }>("/voice/speak", "voice", { device_id: deviceId ?? "local-device", text: clean });
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
  const p = getPlayer();
  p.replace({ uri: `${API_BASE.replace(/\/api$/, "")}${url}` });
  p.play();
  current = clean; notify();
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
