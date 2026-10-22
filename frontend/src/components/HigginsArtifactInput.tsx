/**
 * HigginsArtifactInput — After selecting a category in the check sheet,
 * this component gathers the specific artifact for the investigation.
 *
 * For Screenshot: pick an existing screenshot or take a photo (QR codes, letters, other screens)
 * For URLs: text input for URL
 * For Messages/Calls: text input for message text or phone number
 * For Email/Accounts: text input for email content
 * For Apps/Files: text input for app name or file info
 * For Device/Internet: immediately starts device check
 */

import { Asset } from "expo-asset";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";

import { apiGet } from "@/src/api/client";
import { FILE_SIZE_LIMIT } from "@/src/domain/fileInspection";
import { PhonePickerSheet } from "./PhonePickerSheet";
import { Sheet } from "./Sheet";
import { PREVIEW_SIMULATION } from "./SimulatedPicker";
import { SourcePickerSheet, type SourceChoice } from "./SourcePickerSheet";
import { AppDeviceSdk, type InstalledAppRef } from "@/src/security/appDeviceSdk";
import { PhonePickers } from "@/src/security/phonePickers";
import { useApollo } from "@/src/store/ApolloContext";
import {
  SIMULATED_APPS,
  SIMULATED_CALLS,
  SIMULATED_DEVICE_CONCERNS,
  SIMULATED_EMAILS,
  SIMULATED_FILES,
  SIMULATED_LINKS,
  SIMULATED_SCREENSHOTS,
  SIMULATED_TEXTS,
} from "@/src/preview/samples";
// Preview-only: loaded lazily so the simulatedScreening module is excluded from production bundles.
const callRegisterPreviewImage = __DEV__
  ? (uri: string, sampleId: string) => { (require("@/src/preview/simulatedScreening") as { registerPreviewImage: (u: string, s: string) => void }).registerPreviewImage(uri, sampleId); }
  : (_uri: string, _sampleId: string) => {};
import { ImageUploadPrep, type PreparedImage } from "./ImageUploadPrep";
import { screenImage, type ScreeningResult } from "@/src/domain/imagePrivacy";
import { Button } from "./ui";
import type { HigginsCheckCategory } from "./HigginsCheckSheet";
import type { Gate } from "@/src/investigation/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// ── Category → Gate mapping ─────────────────────────────────────────────────

export function categoryToGate(category: HigginsCheckCategory): Gate | null {
  switch (category) {
    case "screenshot": return null; // determined by content
    case "websites_links": return "link";
    case "messages_calls": return "text";
    case "email_accounts": return "email";
    case "apps_files": return "file";
    case "device_internet": return "device";
    default: return null;
  }
}

const CATEGORY_CONFIG: Record<HigginsCheckCategory, {
  title: string;
  placeholder: string;
  multiline: boolean;
  keyboardType: "default" | "url" | "phone-pad" | "email-address";
  autoCapitalize: "none" | "sentences";
  defaultQuestion: string;
  needsImagePicker?: boolean;
  autoStart?: boolean;
}> = {
  screenshot: {
    title: "Screenshot or photo",
    placeholder: "What would you like Higgins to check in this screenshot?",
    multiline: true,
    keyboardType: "default",
    autoCapitalize: "sentences",
    defaultQuestion: "Is this a scam?",
    needsImagePicker: true,
  },
  websites_links: {
    title: "Check a website or link",
    placeholder: "Paste the URL here",
    multiline: false,
    keyboardType: "url",
    autoCapitalize: "none",
    defaultQuestion: "Is this website safe?",
  },
  messages_calls: {
    title: "Check a message or call",
    placeholder: "Paste the message text, or enter the phone number",
    multiline: true,
    keyboardType: "default",
    autoCapitalize: "sentences",
    defaultQuestion: "Is this message a scam?",
  },
  email_accounts: {
    title: "Check an email or account alert",
    placeholder: "Paste the email content or describe the account alert",
    multiline: true,
    keyboardType: "default",
    autoCapitalize: "sentences",
    defaultQuestion: "Is this email legitimate?",
  },
  apps_files: {
    title: "Check an app or file",
    placeholder: "Enter the app name, or the file name and type",
    multiline: false,
    keyboardType: "default",
    autoCapitalize: "sentences",
    defaultQuestion: "Is this app safe to use?",
  },
  device_internet: {
    title: "Check device & internet",
    placeholder: "Describe any concerns about your device or internet connection",
    multiline: true,
    keyboardType: "default",
    autoCapitalize: "sentences",
    defaultQuestion: "Check my device and internet connection for security issues.",
    autoStart: true,
  },
};

const useStyles = makeStyles((c) => ({
  field: { gap: spacing.xs },
  label: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  hint: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.muted },
  input: {
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.text,
    fontSize: 16,
    color: c.onSurface,
    backgroundColor: c.surfaceSecondary,
    minHeight: 48,
  },
  textArea: {
    minHeight: 84,
    textAlignVertical: "top",
  },
  imagePreviewWrap: {
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: c.border,
    width: "100%",
    height: 130,
  },
  imageThumb: {
    width: "100%",
    height: 130,
  },
  // One compact row of chips instead of a stack of full-width buttons, so the
  // submit action is never pushed below the fold.
  sourceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sourceChip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.brand, backgroundColor: c.surfaceSecondary },
  sourceChipText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  footerRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  cancelBtn: { paddingHorizontal: spacing.sm },
  errorText: { fontFamily: fonts.textMedium, fontSize: 13, lineHeight: 18, color: c.barkingText },
  helper: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    color: c.onSurfaceSecondary,
  },
}));

const SAMPLE_NOTE =
  "Preview only. Selecting one fills the box below — Higgins still runs the real check when you submit.";

// ── Pick from my own things ──────────────────────────────────────────────────
// Each category names the sources a person can pick from instead of typing. On a real phone these read
// the person's own items; in a preview build the same button opens clearly-tagged sample items, because
// the real source (inbox, call log, installed apps) cannot be reached there.
type SourceKey = "email" | "messages" | "calls" | "apps" | "files" | "screenshots" | "links" | "concerns";

const CATEGORY_SOURCES: Record<HigginsCheckCategory, SourceKey[]> = {
  screenshot: ["screenshots"],
  websites_links: ["links"],
  messages_calls: ["messages", "calls"],
  email_accounts: ["email"],
  apps_files: ["apps", "files"],
  device_internet: ["concerns"],
};

const SOURCE_LABEL: Record<SourceKey, string> = {
  email: "Choose from my email",
  messages: "Choose a message",
  calls: "Choose a recent caller",
  apps: "Choose an installed app",
  files: "Choose a file",
  screenshots: "Choose a sample screenshot",
  links: "Choose a sample link",
  concerns: "Choose a sample concern",
};

/** Short chip wording for the compact source row inside the check sheet. */
const SOURCE_CHIP: Record<SourceKey, string> = {
  email: "My email",
  messages: "My messages",
  calls: "Recent callers",
  apps: "Installed apps",
  files: "My files",
  screenshots: "Sample screenshots",
  links: "Sample links",
  concerns: "Sample concerns",
};

const SOURCE_TITLE: Record<SourceKey, string> = {
  email: "Your email",
  messages: "Your messages",
  calls: "Recent callers",
  apps: "Installed apps",
  files: "Your files",
  screenshots: "Sample screenshots",
  links: "Sample links",
  concerns: "Sample concerns",
};

const SOURCE_NOTE: Record<SourceKey, string> = {
  email: "Pick an email and Apollo fills the box below with it. Nothing is sent until you submit.",
  messages: "Pick a message and Apollo fills the box below with it. Nothing is sent until you submit.",
  calls: "Pick a number and Apollo fills the box below with it. Nothing is sent until you submit.",
  apps: "Pick an app and Apollo fills the box below with its name. Nothing is sent until you submit.",
  files: "Pick a file and Apollo fills the box below with its name and type. Nothing is sent until you submit.",
  screenshots: SAMPLE_NOTE,
  links: SAMPLE_NOTE,
  concerns: SAMPLE_NOTE,
};

/** Sources with no real list to read on any device — offered in preview only. */
const PREVIEW_ONLY_SOURCES: SourceKey[] = ["screenshots", "links", "concerns"];

const HERO_CAPTION: Record<HigginsCheckCategory, string> = {
  screenshot: "Apollo reads only the image you choose. It stays on this phone until you submit.",
  websites_links: "Apollo checks where the link really leads.",
  messages_calls: "Only the one message or number you choose — never your inbox or call history.",
  email_accounts: "Only the one email you choose: its sender, its links and what it asks for.",
  apps_files: "The app's source and permissions, or the file's signature and contents.",
  device_internet: "Apollo starts from what you have noticed on this device.",
};

interface InboxItem { id: string; account?: string; from: string; subject: string; snippet: string }

export interface ArtifactResult {
  category: HigginsCheckCategory;
  gate: Gate | null;
  question: string;
  /** For text-based submissions (URL, message, email content, app name) */
  textContent: string | null;
  /** For screenshot submissions */
  imageUri: string | null;
  /** The prepared image (original + sent copy details) for local evidence. */
  preparedImage: PreparedImage | null;
}

interface Props {
  visible: boolean;
  category: HigginsCheckCategory | null;
  /** Pre-fill the question field with text the user already typed in the Higgins chat. */
  initialQuestion?: string;
  onClose: () => void;
  onSubmit: (result: ArtifactResult) => void;
}

export function HigginsArtifactInput({ visible, category, initialQuestion, onClose, onSubmit }: Props) {
  const s = useStyles();
  const { colors } = useTheme();
  const { deviceId } = useApollo();
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [screening, setScreening] = useState<ScreeningResult | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [selectedSample, setSelectedSample] = useState<string | null>(null);
  const [picker, setPicker] = useState<SourceKey | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  /** The app a pasted message arrived in, when the person names it. */
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [apps, setApps] = useState<InstalledAppRef[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<{ email: string }[]>([]);
  const [selectedEmailAccount, setSelectedEmailAccount] = useState<string | null>(null);
  const [inboxPageToken, setInboxPageToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const config = category ? CATEGORY_CONFIG[category] : null;

  // Reset state when sheet opens with a new category; pre-fill question from chat input
  useEffect(() => {
    if (visible && category) {
      setContent("");
      setQuestion(initialQuestion?.trim() || "");
      setImageUri(null);
      setPicking(false);
      setScreening(null);
      setPrepError(null);
      setCameraBlocked(false);
      setSelectedSample(null);
      setPicker(null);
      setSourceError(null);
      setSelectedEmailAccount(null);
      setInboxPageToken(null);
    }
  }, [visible, category]);

  const pickImage = useCallback(async () => {
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        setImageUri(result.assets[0].uri);
      }
    } catch (err) {
      console.warn("[HigginsArtifactInput] Image picker error:", err);
    } finally {
      setPicking(false);
    }
  }, []);

  // Camera: used only for the photo the person chooses to take here (QR codes, letters, screens).
  const takePhoto = useCallback(async () => {
    setCameraBlocked(false);
    let perm = await ImagePicker.getCameraPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) { setCameraBlocked(true); return; }
      perm = await ImagePicker.requestCameraPermissionsAsync();
    }
    if (!perm.granted) {
      if (!perm.canAskAgain) setCameraBlocked(true);
      return;
    }
    setPicking(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.85,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        setImageUri(result.assets[0].uri);
      }
    } catch (err) {
      console.warn("[HigginsArtifactInput] Camera error:", err);
      setPrepError("Apollo couldn't open the camera. You can select an image instead.");
    } finally {
      setPicking(false);
    }
  }, []);

  // Whatever is picked — real item or preview sample — lands in the same field the person could have
  // typed into. The submission still runs Apollo's real check; nothing here pre-empts a verdict.
  const fillSample = useCallback((id: string, text: string, suggestedQuestion?: string) => {
    setContent(text);
    setSelectedSample(id);
    if (suggestedQuestion) setQuestion((q) => q.trim() || suggestedQuestion);
    // Back to the entry popup, which looks exactly as it does in production.
    setPicker(null);
  }, []);

  const fillSampleScreenshot = useCallback(async (id: string) => {
    const sample = SIMULATED_SCREENSHOTS.find((x) => x.id === id);
    if (!sample) return;
    setPicking(true);
    try {
      const asset = Asset.fromModule(sample.asset);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      // The preview has no native text recogniser; this tells the screening boundary that the text
      // of THIS sample image is known, so the real screening can run on its actual contents.
      callRegisterPreviewImage(uri, sample.id);
      setImageUri(uri);
      setSelectedSample(sample.id);
      setQuestion((q) => q.trim() || sample.question);
      setPicker(null);
    } catch (err) {
      console.warn("[HigginsArtifactInput] Sample screenshot error:", err);
    } finally {
      setPicking(false);
    }
  }, []);

  // ── Real sources ───────────────────────────────────────────────────────────
  // A failed read is reported as a failed read. It is never shown as "nothing found", and the typed
  // field always stays available so a person is never dead-ended.
  const loadInbox = useCallback(async (accountEmail?: string | null, append?: boolean) => {
    if (!deviceId) { setSourceError("Apollo hasn't finished starting up. Try again in a moment."); return; }
    if (append) setLoadingMore(true); else setSourceLoading(true);
    setSourceError(null);
    try {
      // Fetch account list (only on first load, not when paginating)
      if (!append) {
        const status = await apiGet<{ connected: boolean; accounts?: { email: string }[] }>(`/gmail/status?device_id=${deviceId}`);
        if (!status.connected) {
          setInbox([]);
          setEmailAccounts([]);
          setSourceError("No email account is connected yet. Connect one in Apollo's email check, or paste the email into the box instead.");
          return;
        }
        setEmailAccounts(status.accounts ?? []);
      }
      // Build the messages URL with optional account filter and pagination
      const params = new URLSearchParams({ device_id: deviceId, limit: "10" });
      const effectiveAccount = accountEmail !== undefined ? accountEmail : selectedEmailAccount;
      if (effectiveAccount) params.set("email", effectiveAccount);
      if (append && inboxPageToken) params.set("page_token", inboxPageToken);
      const data = await apiGet<{ messages: InboxItem[]; next_page_token?: string | null }>(`/gmail/messages?${params}`);
      if (append) {
        setInbox((prev) => [...prev, ...(data.messages ?? [])]);
      } else {
        setInbox(data.messages ?? []);
      }
      setInboxPageToken(data.next_page_token ?? null);
    } catch {
      if (!append) setInbox([]);
      setSourceError("Apollo couldn't read your inbox just now. You can paste the email into the box instead.");
    } finally {
      setSourceLoading(false);
      setLoadingMore(false);
    }
  }, [deviceId, selectedEmailAccount, inboxPageToken]);

  /** Switch to a different email account and reload the inbox. */
  const handleAccountChange = useCallback((email: string | null) => {
    setSelectedEmailAccount(email);
    setInboxPageToken(null);
    setInbox([]);
    void loadInbox(email);
  }, [loadInbox]);

  /** Load the next page of emails. */
  const handleLoadMore = useCallback(() => {
    if (!inboxPageToken || loadingMore) return;
    void loadInbox(selectedEmailAccount, true);
  }, [loadInbox, inboxPageToken, loadingMore, selectedEmailAccount]);

  const loadApps = useCallback(async () => {
    setSourceLoading(true);
    setSourceError(null);
    try {
      setApps(await AppDeviceSdk.listInstalledApps());
    } catch {
      setApps([]);
      setSourceError("Apollo couldn't read the list of installed apps from this device. Type the app name into the box instead.");
    } finally {
      setSourceLoading(false);
    }
  }, []);

  /** Pick a real file: its name and type go in the field, which is what a file check works from. */
  const pickFile = useCallback(async () => {
    setPicking(true);
    setPrepError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      const file = !res.canceled ? res.assets?.[0] : null;
      if (file) {
        if (file.size != null && file.size > FILE_SIZE_LIMIT) {
          setPrepError(`That file is ${Math.round(file.size / (1024 * 1024))} MB — Apollo's limit is ${FILE_SIZE_LIMIT / (1024 * 1024)} MB. Choose a smaller file.`);
          return;
        }
        fillSample(file.uri, `${file.name}${file.mimeType ? ` (${file.mimeType})` : ""}`, "Is this file safe to open?");
      }
    } catch {
      setPrepError("Apollo couldn't open the file picker. You can type the file name and type instead.");
    } finally {
      setPicking(false);
    }
  }, [fillSample]);

  /** Screenshot category: browse the file system for an image, alongside the gallery and camera. */
  const browseForImage = useCallback(async () => {
    setPicking(true);
    setPrepError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true, multiple: false });
      const file = !res.canceled ? res.assets?.[0] : null;
      if (file) {
        if (file.size != null && file.size > FILE_SIZE_LIMIT) {
          setPrepError(`That image is ${Math.round(file.size / (1024 * 1024))} MB — Apollo's limit is ${FILE_SIZE_LIMIT / (1024 * 1024)} MB. Choose a smaller image.`);
          return;
        }
        setImageUri(file.uri);
        setSelectedSample(null);
      }
    } catch {
      setPrepError("Apollo couldn't open the file browser. You can select an image from your photos instead.");
    } finally {
      setPicking(false);
    }
  }, []);

  const openSource = useCallback((key: SourceKey) => {
    // The OS file picker is its own screen — no list of Apollo's to show in front of it.
    if (key === "files" && !PREVIEW_SIMULATION) { void pickFile(); return; }
    setSourceError(null);
    setPicker(key);
    if (PREVIEW_SIMULATION) return;  // sample rows need no loading
    if (key === "email") void loadInbox();
    if (key === "apps") void loadApps();
  }, [loadApps, loadInbox, pickFile]);

  // Preview rows, shaped exactly like the real ones so the picker behaves identically either way.
  const previewRows = useMemo<Record<SourceKey, SourceChoice[]>>(() => ({
    email: SIMULATED_EMAILS.map((x) => ({ id: x.id, primary: x.subject, secondary: x.from, meta: x.probes })),
    messages: SIMULATED_TEXTS.map((x) => ({ id: x.id, primary: x.sender, secondary: x.text, meta: x.probes })),
    calls: SIMULATED_CALLS.map((x) => ({ id: x.id, primary: x.number, secondary: x.name ?? undefined, meta: x.probes })),
    apps: SIMULATED_APPS.map((x) => ({ id: x.id, primary: x.appName, secondary: x.packageId, meta: x.probes })),
    files: SIMULATED_FILES.map((x) => ({ id: x.id, primary: x.name, secondary: x.mime, meta: x.probes })),
    screenshots: SIMULATED_SCREENSHOTS.map((x) => ({ id: x.id, primary: x.label, meta: x.probes })),
    links: SIMULATED_LINKS.map((x) => ({ id: x.id, primary: x.url, meta: x.probes })),
    concerns: SIMULATED_DEVICE_CONCERNS.map((x) => ({ id: x.id, primary: x.concern, meta: x.probes })),
  }), []);

  const pickPreview = useCallback((key: SourceKey, id: string) => {
    if (key === "screenshots") { void fillSampleScreenshot(id); return; }
    if (key === "email") {
      const x = SIMULATED_EMAILS.find((e) => e.id === id);
      if (x) fillSample(x.id, `From: ${x.from}\nSubject: ${x.subject}\n\n${x.body}`, "Is this email legitimate?");
      return;
    }
    if (key === "messages") {
      const x = SIMULATED_TEXTS.find((t) => t.id === id);
      if (x) fillSample(x.id, `${x.app ? `Source app: ${x.app}\n` : ""}From ${x.sender}:\n${x.text}`, "Is this message a scam?");
      return;
    }
    if (key === "calls") {
      const x = SIMULATED_CALLS.find((c) => c.id === id);
      if (x) fillSample(x.id, x.name ? `${x.number} (saved as ${x.name})` : x.number, "Who called me from this number?");
      return;
    }
    if (key === "apps") {
      const x = SIMULATED_APPS.find((a) => a.id === id);
      if (x) fillSample(x.id, `${x.appName} (${x.packageId}) by ${x.developer}`, "Is this app safe to use?");
      return;
    }
    if (key === "files") {
      const x = SIMULATED_FILES.find((f) => f.id === id);
      if (x) fillSample(x.id, `${x.name} (${x.mime})`, "Is this file safe to open?");
      return;
    }
    if (key === "links") {
      const x = SIMULATED_LINKS.find((l) => l.id === id);
      if (x) fillSample(x.id, x.url, "Is this website safe?");
      return;
    }
    const concern = SIMULATED_DEVICE_CONCERNS.find((c) => c.id === id);
    if (concern) fillSample(concern.id, concern.concern);
  }, [fillSample, fillSampleScreenshot]);

  /** A real email: fetch the full body so the check reads the whole message, not just the preview line. */
  const pickInboxEmail = useCallback(async (id: string) => {
    const msg = inbox.find((m) => m.id === id);
    if (!msg) return;
    setSourceLoading(true);
    let body = msg.snippet;
    try {
      const detail = await apiGet<{ from: string; subject: string; body: string }>(
        `/gmail/message/${id}?device_id=${deviceId}${msg.account ? `&email=${encodeURIComponent(msg.account)}` : ""}`,
      );
      body = detail.body || msg.snippet;
    } catch {
      // Keep the preview line rather than nothing, and say what was used.
      setPrepError("Apollo could only read the preview line of that email, not the full message.");
    } finally {
      setSourceLoading(false);
    }
    fillSample(id, `From: ${msg.from}\nSubject: ${msg.subject}\n\n${body}`, "Is this email legitimate?");
  }, [deviceId, fillSample, inbox]);

  const pickFromSource = useCallback((key: SourceKey, id: string) => {
    if (PREVIEW_SIMULATION) { pickPreview(key, id); return; }
    if (key === "email") { void pickInboxEmail(id); return; }
    if (key === "apps") {
      const app = apps.find((a) => a.packageId === id);
      if (app) fillSample(app.packageId, `${app.appName} (${app.packageId})`, "Is this app safe to use?");
    }
  }, [apps, fillSample, pickInboxEmail, pickPreview]);


  const submit = (prepared: PreparedImage | null) => {
    if (!category || !config) return;
    const text = content.trim();
    onSubmit({
      category,
      gate: categoryToGate(category),
      question: question.trim() || config.defaultQuestion,
      textContent: text || null,
      imageUri: prepared?.imageUri ?? null,
      preparedImage: prepared,
    });
  };

  // Images: warn → Continue → black out detected credentials on a copy → submit the copy (original untouched).
  const handleSubmit = async () => {
    if (!imageUri) { submit(null); return; }
    setPrepError(null);
    try { setScreening(await screenImage(imageUri, "investigation_evidence")); }
    catch { setPrepError("Apollo couldn't prepare this image. Nothing was sent."); }
  };

  const canSubmit = category === "screenshot"
    ? !!imageUri
    : category === "device_internet"
      ? true
      : !!content.trim();

  if (!visible || !category || !config) return null;

  // Which "choose from my ..." buttons this category offers. Preview-only sources appear only in a
  // preview build; sources that need a native list are hidden where the platform cannot provide one,
  // so a button is never offered that can only dead-end.
  const sources = CATEGORY_SOURCES[category].filter((key) => {
    if (PREVIEW_ONLY_SOURCES.includes(key)) return PREVIEW_SIMULATION;
    if (PREVIEW_SIMULATION) return true;
    if (key === "messages" || key === "calls") return PhonePickers.isSupported();
    if (key === "apps") return Platform.OS === "android";
    return true;  // email (asks the server) and files (the OS picker) work everywhere
  });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={config.title}
      testID="higgins-artifact-sheet"
      scrollRef={scrollRef}
      footer={
        <>
          {prepError ? <Text style={s.errorText} testID="higgins-artifact-prep-error">{prepError}</Text> : null}
          <View style={s.footerRow}>
            <Button
              testID="higgins-artifact-cancel"
              variant="ghost"
              label="Cancel"
              onPress={onClose}
              style={s.cancelBtn}
            />
            <Button
              testID="higgins-artifact-submit"
              label="Ask Higgins to investigate"
              onPress={() => void handleSubmit()}
              disabled={!canSubmit}
              style={{ flex: 1 }}
            />
          </View>
        </>
      }
    >
      {/* Picking beats typing, but it must not push the submit button off the screen: the person's
          own sources sit on one compact row of chips rather than a stack of full-width buttons. */}
      {sources.length ? (
        <View style={s.sourceRow} testID="higgins-artifact-hero">
          {sources.map((key) => (
            <Pressable
              key={key}
              testID={`higgins-artifact-source-${key}`}
              accessibilityRole="button"
              accessibilityLabel={SOURCE_LABEL[key]}
              disabled={picking}
              onPress={() => openSource(key)}
              style={[s.sourceChip, picking && { opacity: 0.5 }]}
            >
              <Text style={s.sourceChipText} numberOfLines={1}>{SOURCE_CHIP[key]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {sources.length ? <Text style={s.hint}>{HERO_CAPTION[category]}</Text> : null}
      {selectedSample ? (
        <Text style={s.helper} testID="higgins-artifact-sample-loaded">
          Loaded below — check it reads the way you expect.
        </Text>
      ) : null}
      {/* Screenshot: image picker + optional question */}
      {category === "screenshot" ? (
        <>
          {imageUri ? (
            <View style={s.imagePreviewWrap} testID="higgins-artifact-image-selected">
              <Image source={imageUri} style={s.imageThumb} contentFit="cover" />
            </View>
          ) : null}
          <View style={s.sourceRow}>
            <Pressable testID={imageUri ? "higgins-artifact-change-image" : "higgins-artifact-pick-image"} accessibilityRole="button" accessibilityLabel={imageUri ? "Choose a different image" : "Select an image"} disabled={picking} onPress={() => void pickImage()} style={[s.sourceChip, picking && { opacity: 0.5 }]}>
              <Text style={s.sourceChipText}>{picking ? "Opening…" : imageUri ? "Different image" : "My photos"}</Text>
            </Pressable>
            <Pressable testID="higgins-artifact-take-photo" accessibilityRole="button" accessibilityLabel={imageUri ? "Take a different photo" : "Take a photo"} disabled={picking} onPress={() => void takePhoto()} style={[s.sourceChip, picking && { opacity: 0.5 }]}>
              <Text style={s.sourceChipText}>Camera</Text>
            </Pressable>
            <Pressable testID="higgins-artifact-browse-files" accessibilityRole="button" accessibilityLabel="Browse files" disabled={picking} onPress={() => void browseForImage()} style={[s.sourceChip, picking && { opacity: 0.5 }]}>
              <Text style={s.sourceChipText}>Files</Text>
            </Pressable>
          </View>
          <Text style={s.hint}>
            A screenshot, a QR code, a letter or anything else in front of you. It stays on this phone
            until you submit it.
          </Text>
          {cameraBlocked ? (
            <>
              <Text style={s.helper} testID="higgins-artifact-camera-blocked">
                Camera access is turned off for Apollo, so photos cannot be taken. You can still select
                an image from your photos.
              </Text>
              <Button
                testID="higgins-artifact-camera-settings"
                variant="ghost"
                label="Open Settings"
                onPress={() => void Linking.openSettings()}
              />
            </>
          ) : null}
          <View style={s.field}>
            <Text style={s.label}>Your question (optional)</Text>
            <TextInput
              testID="higgins-artifact-question"
              style={s.input}
              value={question}
              onChangeText={setQuestion}
              placeholder="e.g. Is this a scam?"
              placeholderTextColor={colors.muted}
            />
          </View>
        </>
      ) : category === "device_internet" ? (
        /* Device & Internet: optional description */
        <View style={s.field}>
          <Text style={s.label}>Describe your concern (optional)</Text>
          <TextInput
            testID="higgins-artifact-content"
            style={[s.input, s.textArea]}
            value={content}
            onChangeText={setContent}
            placeholder={config.placeholder}
            placeholderTextColor={colors.muted}
            multiline
          />
        </View>
      ) : (
        /* Text-based categories: content input + optional question */
        <>
          <View style={s.field}>
            <Text style={s.label}>
              {category === "websites_links" ? "URL" : "Content"}
            </Text>
            <TextInput
              testID="higgins-artifact-content"
              style={[s.input, config.multiline && s.textArea]}
              value={content}
              onChangeText={setContent}
              placeholder={config.placeholder}
              placeholderTextColor={colors.muted}
              multiline={config.multiline}
              keyboardType={config.keyboardType}
              autoCapitalize={config.autoCapitalize}
              autoCorrect={category !== "websites_links"}
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Your question (optional)</Text>
            <TextInput
              testID="higgins-artifact-question"
              style={s.input}
              value={question}
              onChangeText={setQuestion}
              placeholder="e.g. Is this a scam?"
              placeholderTextColor={colors.muted}
            />
          </View>
        </>
      )}

      {/* The real message/caller lists carry their own permission flow, so they use the shared picker
          that already handles explain → ask → Open Settings. */}
      {!PREVIEW_SIMULATION && (picker === "messages" || picker === "calls") ? (
        <PhonePickerSheet
          visible
          mode={picker === "messages" ? "sms" : "calls"}
          onClose={() => setPicker(null)}
          onPickSms={(sms) => fillSample(`${sms.address}-${sms.date}`, `From ${sms.address}:\n${sms.body}`, "Is this message a scam?")}
          onPickCall={(call) => fillSample(`${call.number}-${call.date}`, call.name ? `${call.number} (saved as ${call.name})` : call.number, "Who called me from this number?")}
        />
      ) : null}
      {picker && !(!PREVIEW_SIMULATION && (picker === "messages" || picker === "calls")) ? (
        <SourcePickerSheet
          visible
          title={SOURCE_TITLE[picker]}
          note={SOURCE_NOTE[picker]}
          preview={PREVIEW_SIMULATION}
          loading={sourceLoading}
          error={sourceError}
          items={PREVIEW_SIMULATION ? previewRows[picker] : picker === "email"
            ? inbox.map((m) => ({ id: m.id, primary: m.subject || "(no subject)", secondary: m.from, meta: m.snippet }))
            : picker === "apps"
              ? apps.map((a) => ({ id: a.packageId, primary: a.appName, secondary: a.packageId }))
              : []}
          emptyText={picker === "email"
            ? "There is nothing in the last 30 days of the connected inbox."
            : picker === "apps"
              ? "This device reported no installed apps Apollo can list."
              : "Nothing to choose from here."}
          selectedId={selectedSample}
          onSelect={(id) => pickFromSource(picker, id)}
          onClose={() => setPicker(null)}
          testID={`higgins-artifact-picker-${picker}`}
          /* Email-only: account chooser + pagination */
          accounts={picker === "email" ? emailAccounts : undefined}
          selectedAccount={picker === "email" ? selectedEmailAccount : undefined}
          onAccountChange={picker === "email" ? handleAccountChange : undefined}
          hasMore={picker === "email" ? !!inboxPageToken : undefined}
          loadingMore={picker === "email" ? loadingMore : undefined}
          onLoadMore={picker === "email" ? handleLoadMore : undefined}
        />
      ) : null}
      {screening ? (
        <ImageUploadPrep
          visible={!!screening}
          screening={screening}
          onComplete={(r) => { setScreening(null); submit(r); }}
          onCancel={() => setScreening(null)}
        />
      ) : null}
    </Sheet>
  );
}
