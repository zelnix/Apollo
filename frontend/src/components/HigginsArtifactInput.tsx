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
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Linking, ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";

import { Sheet } from "./Sheet";
import { SimulatedPicker } from "./SimulatedPicker";
import { SIMULATED_EMAILS } from "@/src/preview/simulatedInbox";
import {
  SIMULATED_APPS,
  SIMULATED_CALLS,
  SIMULATED_DEVICE_CONCERNS,
  SIMULATED_FILES,
  SIMULATED_LINKS,
  SIMULATED_SCREENSHOTS,
  SIMULATED_TEXTS,
} from "@/src/preview/simulatedItems";
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
    minHeight: 100,
    textAlignVertical: "top",
  },
  imagePreview: {
    fontFamily: fonts.textMedium,
    fontSize: 14,
    color: c.resting,
    paddingVertical: spacing.sm,
  },
  imagePreviewWrap: {
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: c.border,
    width: "100%",
    height: 200,
  },
  imageThumb: {
    width: "100%",
    height: 200,
  },
  questionField: {
    marginTop: spacing.sm,
  },
  helper: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    color: c.onSurfaceSecondary,
  },
}));

const SAMPLE_NOTE =
  "Preview only. Selecting one fills the box below — Higgins still runs the real check when you submit.";

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
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [screening, setScreening] = useState<ScreeningResult | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [selectedSample, setSelectedSample] = useState<string | null>(null);
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

  // Preview-only: fill the field with a sample. The person still submits, and the submission runs
  // Apollo's real check — nothing here decides or pre-empts a verdict.
  const fillSample = useCallback((id: string, text: string, suggestedQuestion?: string) => {
    setContent(text);
    setSelectedSample(id);
    if (suggestedQuestion) setQuestion((q) => q.trim() || suggestedQuestion);
    // The field sits below the sample list, so bring it into view — otherwise the tap looks ignored.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const fillSampleScreenshot = useCallback(async (id: string) => {
    const sample = SIMULATED_SCREENSHOTS.find((x) => x.id === id);
    if (!sample) return;
    setPicking(true);
    try {
      const asset = Asset.fromModule(sample.asset);
      await asset.downloadAsync();
      setImageUri(asset.localUri ?? asset.uri);
      setSelectedSample(sample.id);
      setQuestion((q) => q.trim() || sample.question);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      console.warn("[HigginsArtifactInput] Sample screenshot error:", err);
    } finally {
      setPicking(false);
    }
  }, []);

  const submit = (prepared: PreparedImage | null) => {
    if (!category || !config) return;
    onSubmit({
      category,
      gate: categoryToGate(category),
      question: question.trim() || config.defaultQuestion,
      textContent: content.trim() || null,
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

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={config.title}
      testID="higgins-artifact-sheet"
      scrollRef={scrollRef}
    >
      {selectedSample ? (
        <Text style={s.helper} testID="higgins-artifact-sample-loaded">
          Sample loaded below. Check it reads the way you expect, then tap &ldquo;Ask Higgins to investigate&rdquo;.
        </Text>
      ) : null}
      {/* Screenshot: image picker + optional question */}
      {category === "screenshot" ? (
        <>
          <SimulatedPicker
            testID="higgins-sample-screenshots"
            title="Sample screenshots"
            note={SAMPLE_NOTE}
            items={SIMULATED_SCREENSHOTS.map((x) => ({
              id: x.id,
              primary: x.label,
              probes: x.probes,
            }))}
            onSelect={(id) => void fillSampleScreenshot(id)}
            selectedId={selectedSample}
            disabled={picking}
          />
          {imageUri ? (
            <View style={s.imagePreviewWrap} testID="higgins-artifact-image-selected">
              <Image source={imageUri} style={s.imageThumb} contentFit="cover" />
            </View>
          ) : null}
          <Button
            testID={imageUri ? "higgins-artifact-change-image" : "higgins-artifact-pick-image"}
            variant={imageUri ? "ghost" : "secondary"}
            label={picking ? "Opening…" : imageUri ? "Choose a different image" : "Select an image"}
            onPress={() => void pickImage()}
            disabled={picking}
          />
          <Button
            testID="higgins-artifact-take-photo"
            variant="ghost"
            label={imageUri ? "Take a different photo" : "Take a photo"}
            onPress={() => void takePhoto()}
            disabled={picking}
          />
          <Text style={s.helper}>
            Use the camera for a QR code, a letter, a parcel card or another screen in front of you.
            The photo stays on your device until you submit it.
          </Text>
          {cameraBlocked ? (
            <>
              <Text style={s.helper} testID="higgins-artifact-camera-blocked">
                Camera access is turned off for Apollo, so photos cannot be taken. Everything else still
                works — you can select an image from your photos instead.
              </Text>
              <Button
                testID="higgins-artifact-camera-settings"
                variant="ghost"
                label="Open Settings"
                onPress={() => void Linking.openSettings()}
              />
            </>
          ) : null}
          <View style={[s.field, s.questionField]}>
            <Text style={s.label}>Your question (optional)</Text>
            <TextInput
              testID="higgins-artifact-question"
              style={[s.input, s.textArea]}
              value={question}
              onChangeText={setQuestion}
              placeholder={config.placeholder}
              placeholderTextColor={colors.muted}
              multiline
            />
          </View>
        </>
      ) : category === "device_internet" ? (
        /* Device & Internet: optional description */
        <View style={s.field}>
          <SimulatedPicker
            testID="higgins-sample-device"
            title="Sample concerns"
            note={SAMPLE_NOTE}
            items={SIMULATED_DEVICE_CONCERNS.map((x) => ({
              id: x.id,
              primary: x.concern,
              probes: x.probes,
            }))}
            onSelect={(id) => {
              const sample = SIMULATED_DEVICE_CONCERNS.find((x) => x.id === id);
              if (sample) fillSample(sample.id, sample.concern);
            }}
          selectedId={selectedSample}
              />
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
          {category === "websites_links" ? (
            <SimulatedPicker
              testID="higgins-sample-links"
              title="Sample links"
              note={SAMPLE_NOTE}
              items={SIMULATED_LINKS.map((x) => ({ id: x.id, primary: x.url, probes: x.probes }))}
              onSelect={(id) => {
                const sample = SIMULATED_LINKS.find((x) => x.id === id);
                if (sample) fillSample(sample.id, sample.url, "Is this website safe?");
              }}
            selectedId={selectedSample}
              />
          ) : null}

          {category === "messages_calls" ? (
            <>
              <SimulatedPicker
                testID="higgins-sample-messages"
                title="Sample messages"
                note={SAMPLE_NOTE}
                items={SIMULATED_TEXTS.map((x) => ({
                  id: x.id,
                  primary: x.sender,
                  secondary: x.text,
                  probes: x.probes,
                }))}
                onSelect={(id) => {
                  const sample = SIMULATED_TEXTS.find((x) => x.id === id);
                  if (sample) fillSample(sample.id, `From ${sample.sender}:\n${sample.text}`, "Is this message a scam?");
                }}
              selectedId={selectedSample}
              />
              <SimulatedPicker
                testID="higgins-sample-calls"
                title="Sample callers"
                note={SAMPLE_NOTE}
                items={SIMULATED_CALLS.map((x) => ({
                  id: x.id,
                  primary: x.number,
                  secondary: x.name ?? undefined,
                  probes: x.probes,
                }))}
                onSelect={(id) => {
                  const sample = SIMULATED_CALLS.find((x) => x.id === id);
                  if (sample) {
                    fillSample(
                      sample.id,
                      sample.name ? `${sample.number} (saved as ${sample.name})` : sample.number,
                      "Who called me from this number?",
                    );
                  }
                }}
              selectedId={selectedSample}
              />
            </>
          ) : null}

          {category === "email_accounts" ? (
            <SimulatedPicker
              testID="higgins-sample-emails"
              title="Sample emails"
              note={SAMPLE_NOTE}
              items={SIMULATED_EMAILS.map((x) => ({
                id: x.id,
                primary: x.subject,
                secondary: x.from,
                probes: x.probes,
              }))}
              onSelect={(id) => {
                const sample = SIMULATED_EMAILS.find((x) => x.id === id);
                if (sample) {
                  fillSample(
                    sample.id,
                    `From: ${sample.from}\nSubject: ${sample.subject}\n\n${sample.body}`,
                    "Is this email legitimate?",
                  );
                }
              }}
            selectedId={selectedSample}
              />
          ) : null}

          {category === "apps_files" ? (
            <>
              <SimulatedPicker
                testID="higgins-sample-apps"
                title="Sample apps"
                note={SAMPLE_NOTE}
                items={SIMULATED_APPS.map((x) => ({
                  id: x.id,
                  primary: x.appName,
                  secondary: x.packageId,
                  probes: x.probes,
                }))}
                onSelect={(id) => {
                  const sample = SIMULATED_APPS.find((x) => x.id === id);
                  if (sample) {
                    fillSample(
                      sample.id,
                      `${sample.appName} (${sample.packageId}) by ${sample.developer}`,
                      "Is this app safe to use?",
                    );
                  }
                }}
              selectedId={selectedSample}
              />
              <SimulatedPicker
                testID="higgins-sample-files"
                title="Sample files"
                note={SAMPLE_NOTE}
                items={SIMULATED_FILES.map((x) => ({
                  id: x.id,
                  primary: x.name,
                  secondary: x.mime,
                  probes: x.probes,
                }))}
                onSelect={(id) => {
                  const sample = SIMULATED_FILES.find((x) => x.id === id);
                  if (sample) {
                    fillSample(sample.id, `${sample.name} (${sample.mime})`, "Is this file safe to open?");
                  }
                }}
              selectedId={selectedSample}
              />
            </>
          ) : null}

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
          <View style={[s.field, s.questionField]}>
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

      {prepError ? <Text style={s.label} testID="higgins-artifact-prep-error">{prepError}</Text> : null}
      <Button
        testID="higgins-artifact-submit"
        label="Ask Higgins to investigate"
        onPress={() => void handleSubmit()}
        disabled={!canSubmit}
      />
      <Button
        testID="higgins-artifact-cancel"
        variant="ghost"
        label="Cancel"
        onPress={onClose}
      />
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
