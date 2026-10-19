/**
 * HigginsArtifactInput — After selecting a category in the check sheet,
 * this component gathers the specific artifact for the investigation.
 *
 * For Screenshot: opens image picker
 * For URLs: text input for URL
 * For Messages/Calls: text input for message text or phone number
 * For Email/Accounts: text input for email content
 * For Apps/Files: text input for app name or file info
 * For Device/Internet: immediately starts device check
 */

import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Image } from "expo-image";

import { Sheet } from "./Sheet";
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
    title: "Select a screenshot",
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
    title: "Check an app",
    placeholder: "Enter the app name or its package/bundle identifier",
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
}));

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
    >
      {/* Screenshot: image picker + optional question */}
      {category === "screenshot" ? (
        <>
          {imageUri ? (
            <View style={s.imagePreviewWrap} testID="higgins-artifact-image-selected">
              <Image source={imageUri} style={s.imageThumb} contentFit="cover" />
            </View>
          ) : null}
          <Button
            testID={imageUri ? "higgins-artifact-change-image" : "higgins-artifact-pick-image"}
            variant={imageUri ? "ghost" : "secondary"}
            label={picking ? "Opening gallery…" : imageUri ? "Choose a different image" : "Select an image"}
            onPress={() => void pickImage()}
            disabled={picking}
          />
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
