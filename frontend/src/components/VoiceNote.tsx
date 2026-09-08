// Guardian Voice Note — record ≤ 30 s of reassurance onto a shared incident (guardian side) and play it back (both
// sides). Audio never carries a bearer token in a URL: playback uses a short-lived ticket minted by the backend.
// Microphone permission follows the contract: ask only on intent, explain first, respect canAskAgain, offer Settings.
import { createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, getRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, type AudioPlayer } from "expo-audio";
import Mic from "lucide-react-native/icons/mic";
import Pause from "lucide-react-native/icons/pause";
import Play from "lucide-react-native/icons/play";
import Send from "lucide-react-native/icons/send";
import Volume2 from "lucide-react-native/icons/volume-2";
import React, { useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";

import { apiGet, apiUpload } from "@/src/api/client";
import { Body, Button } from "@/src/components/ui";
import { useApollo } from "@/src/store/ApolloContext";
import { useHiggins } from "@/src/voice/higgins";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export const VOICE_MAX_SECONDS = 30;

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  timer: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface, minWidth: 48 },
  hint: { fontFamily: fonts.text, fontSize: 13, color: c.muted, flex: 1 },
  playBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, alignSelf: "flex-start" },
  playText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  caption: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface, fontStyle: "italic" },
  higginsBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minHeight: 44, alignSelf: "flex-start", paddingRight: spacing.sm },
  higginsText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.brand },
}));

const fmt = (ms: number) => { const s = Math.min(VOICE_MAX_SECONDS, Math.floor(ms / 1000)); return `0:${String(s).padStart(2, "0")}`; };

type Phase = "idle" | "explain" | "blocked" | "recording" | "review" | "sending";

export function VoiceNoteRecorder({ scentId, deviceId, fromName, onSent }: { scentId: string; deviceId: string; fromName: string; onSent: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { showToast } = useApollo();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const stopping = useRef(false);

  const stop = async () => {
    if (stopping.current) return; stopping.current = true;
    try { setDurationMs(state.durationMillis); await recorder.stop(); setPhase("review"); }
    catch { setErr("The recording couldn't be saved. Try again."); setPhase("idle"); }
    finally { stopping.current = false; }
  };
  // Hard cap: stop at 30 s so the note stays short (and under the upload limit).
  useEffect(() => { if (phase === "recording" && state.durationMillis >= VOICE_MAX_SECONDS * 1000) void stop(); }, [phase, state.durationMillis]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    setErr(null);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
    } catch { setErr("Apollo couldn't start the microphone. Close other apps using it and try again."); setPhase("idle"); }
  };

  const onIntent = async () => {
    setErr(null);
    const cur = await getRecordingPermissionsAsync();
    if (cur.granted) return begin();
    if (!cur.canAskAgain) { setPhase("blocked"); return; }
    setPhase("explain"); // one short, benefit-led explanation before the system prompt
  };
  const ask = async () => {
    const r = await requestRecordingPermissionsAsync();
    if (r.granted) return begin();
    setPhase(r.canAskAgain ? "idle" : "blocked");
    if (r.canAskAgain) setErr("No microphone this time — you can still send a written note.");
  };

  const send = async () => {
    const uri = recorder.uri ?? state.url;
    if (!uri) { setErr("Nothing was recorded."); setPhase("idle"); return; }
    setPhase("sending");
    const isWeb = Platform.OS === "web";
    const type = isWeb ? "audio/webm" : "audio/m4a";
    try {
      await apiUpload(`/family/incidents/${scentId}/voice`, "family", { device_id: deviceId, from_name: fromName, duration_s: String(Math.min(VOICE_MAX_SECONDS, Math.round(durationMs / 100) / 10)) }, { uri, name: isWeb ? "note.webm" : "note.m4a", type });
      showToast("Voice note sent. They'll hear it on the incident.", "resting");
      setPhase("idle"); onSent();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send the voice note."); setPhase("review"); }
  };

  if (phase === "explain") return (
    <View style={{ gap: spacing.sm }} testID="voice-note-explain">
      <Body>Apollo needs the microphone only while you record — so they can hear it&apos;s really you. Nothing is recorded until you press the button.</Body>
      <View style={s.row}><Button testID="voice-note-allow" label="Allow microphone" onPress={() => void ask()} /><Button testID="voice-note-not-now" variant="ghost" label="Not now" onPress={() => setPhase("idle")} /></View>
    </View>
  );
  if (phase === "blocked") return (
    <View style={{ gap: spacing.sm }} testID="voice-note-blocked">
      <Body>Microphone access is turned off for Apollo. You can still send a written note, or allow the microphone in Settings.</Body>
      <View style={s.row}><Button testID="voice-note-open-settings" variant="secondary" label="Open Settings" onPress={() => void Linking.openSettings()} /><Button testID="voice-note-blocked-not-now" variant="ghost" label="Not now" onPress={() => setPhase("idle")} /></View>
    </View>
  );
  if (phase === "recording") return (
    <View style={s.row} testID="voice-note-recording">
      <Text style={s.timer} testID="voice-note-timer">{fmt(state.durationMillis)}</Text>
      <Text style={s.hint}>Recording… up to {VOICE_MAX_SECONDS} seconds. Just say hello like you would on the phone.</Text>
      <Button testID="voice-note-stop" variant="primary" label="Stop" icon={<Pause size={16} color={colors.onBrandPrimary} />} onPress={() => void stop()} />
    </View>
  );
  if (phase === "review" || phase === "sending") return (
    <View style={{ gap: spacing.sm }} testID="voice-note-review">
      <View style={s.row}>
        <Text style={s.timer}>{fmt(durationMs)}</Text>
        <Text style={s.hint}>{phase === "sending" ? "Sending…" : "Ready to send."}</Text>
        <Button testID="voice-note-send" label="Send" icon={<Send size={16} color={colors.onBrandPrimary} />} onPress={() => void send()} disabled={phase === "sending"} />
        <Button testID="voice-note-discard" variant="ghost" label="Discard" onPress={() => { setPhase("idle"); setErr(null); }} disabled={phase === "sending"} />
      </View>
      {err ? <Body testID="voice-note-error">{err}</Body> : null}
    </View>
  );
  return (
    <View style={{ gap: spacing.sm }}>
      <Button testID="voice-note-record" variant="secondary" label="Record a voice note" icon={<Mic size={16} color={colors.onSurface} />} onPress={() => void onIntent()} />
      {err ? <Body testID="voice-note-error">{err}</Body> : null}
    </View>
  );
}

/** Caption under a voice note so it can be read when listening isn't possible. Pending → "Caption coming…"; unavailable → says so. */
export function VoiceCaption({ status, text, testID, deviceId, speaker }: { status?: "pending" | "ready" | "unavailable"; text?: string; testID?: string; deviceId?: string | null; speaker?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const higgins = useHiggins(deviceId ?? null);
  if (status === "ready" && text) {
    // Higgins reads the caption in his own voice — the fallback when the original recording won't play (or can't be heard).
    const line = speaker ? `${speaker} says: ${text}` : text;
    const reading = !!higgins.speaking && higgins.speaking === line.trim().slice(0, 1500);
    return (
      <View style={{ gap: spacing.xs }}>
        <Text style={s.caption} testID={testID}>“{text}”</Text>
        {deviceId ? (
          <Pressable testID={testID ? `${testID}-higgins` : undefined} accessibilityRole="button" accessibilityLabel={reading ? "Stop Higgins" : "Ask Higgins to read this caption"} onPress={() => void higgins.speak(line)} disabled={higgins.busy} style={s.higginsBtn}>
            <Volume2 size={14} color={colors.brand} />
            <Text style={s.higginsText}>{higgins.busy ? "Higgins is clearing his throat…" : reading ? "Stop Higgins" : "Can't play it? Let Higgins read it"}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (status === "pending") return <Text style={s.hint} testID={testID}>Caption coming…</Text>;
  if (status === "unavailable") return <Text style={s.hint} testID={testID}>No caption for this one — press play to listen.</Text>;
  return null;
}

let sharedPlayer: AudioPlayer | null = null;
let playingId: string | null = null;
const playListeners = new Set<() => void>();
function player(): AudioPlayer {
  if (!sharedPlayer) {
    sharedPlayer = createAudioPlayer(null);
    sharedPlayer.addListener("playbackStatusUpdate", (st) => { if (playingId && st.isLoaded && !st.playing && st.duration > 0 && st.currentTime >= st.duration - 0.1) { playingId = null; playListeners.forEach((l) => l()); } });
  }
  return sharedPlayer;
}

/** Plays a voice note through a short-lived ticket URL. Only one note plays at a time. */
export function VoicePlayButton({ noteId, deviceId, durationS, label }: { noteId: string; deviceId: string; durationS?: number; label?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const l = () => force((n) => n + 1); playListeners.add(l); return () => { playListeners.delete(l); }; }, []);
  const active = playingId === noteId;
  const toggle = async () => {
    setErr(null);
    const p = player();
    if (active) { p.pause(); playingId = null; playListeners.forEach((l) => l()); return; }
    setBusy(true);
    try {
      const t = await apiGet<{ url: string }>(`/family/voice/${noteId}/ticket?device_id=${deviceId}`);
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      p.replace({ uri: t.url });
      p.play();
      playingId = noteId; playListeners.forEach((l) => l());
    } catch (e) { setErr(`${e instanceof Error ? e.message : "Couldn't play this voice note right now."} If there's a caption below, Higgins can read it to you.`); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ gap: spacing.xs }}>
      <Pressable testID={`voice-play-${noteId}`} accessibilityRole="button" accessibilityLabel={active ? "Pause voice note" : "Play voice note"} onPress={() => void toggle()} disabled={busy} style={s.playBtn}>
        {active ? <Pause size={16} color={colors.onSurface} /> : <Play size={16} color={colors.onSurface} />}
        <Text style={s.playText}>{busy ? "Loading…" : active ? "Pause" : label ?? "Play voice note"}{durationS ? ` · ${fmt(durationS * 1000)}` : ""}</Text>
      </Pressable>
      {err ? <Body testID={`voice-play-error-${noteId}`}>{err}</Body> : null}
    </View>
  );
}
