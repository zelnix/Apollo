// Prepares a submitted image for investigation: warn → (optional crop) → Continue → black out detected credentials
// on a copy → send. Everything else in the image (names, numbers, emails, medical/financial/payment details, senders,
// URLs, layout) is kept as evidence. The original file is never modified. If a detected credential can't be blacked
// out, the image is not sent (fail closed). Detection relies on on-device text recognition, which can miss text and
// is unavailable in Expo Go / web preview — in that case the copy is sent without credential blackout.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import { captureRef } from "react-native-view-shot";

import { ImageCropper } from "@/src/components/ImageCropper";
import { ImageUploadWarning } from "@/src/components/ImageUploadWarning";
import { screenImage, type ScreeningResult } from "@/src/domain/imagePrivacy";

export interface PreparedImage {
  /** credentials_redacted: copy with detected credentials blacked out; no_credentials_found: metadata-stripped copy;
   *  not_checked: on-device text recognition unavailable, metadata-stripped copy. */
  decision: "credentials_redacted" | "no_credentials_found" | "not_checked";
  /** URI of the analysis copy (the original file is untouched). */
  imageUri: string;
  /** The original image as chosen by the user (before crop) — kept on device only. */
  originalUri: string | null;
  cropped: boolean;
  /** Extracted text with any detected credentials removed (empty when text recognition was unavailable). */
  text: string | null;
  redactedRegions: number;
  screening: ScreeningResult;
}

export interface UploadSubmissionState { phase: "idle" | "sending" | "error"; errorMessage?: string }

export function ImageUploadPrep({ visible, screening: initial, onComplete, onCancel, submissionState, onRetrySubmission, purpose = "investigation_evidence" }: {
  visible: boolean;
  screening: ScreeningResult;
  onComplete: (result: PreparedImage) => void;
  onCancel: () => void;
  submissionState?: UploadSubmissionState;
  onRetrySubmission?: () => void;
  purpose?: "message_screenshot" | "investigation_evidence";
}) {
  const captureViewRef = useRef<View>(null);
  const [screening, setScreening] = useState(initial);
  const [cropped, setCropped] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  useEffect(() => { setScreening(initial); setCropped(false); setPrepError(null); }, [initial]);

  const originalUri = initial.sourceUri ?? null;
  const credentials = screening.sensitiveRegions.filter((r) => r.sensitiveType === "credential");
  const dims = screening.dimensions ?? { width: 1, height: 1 };

  const prepare = useCallback(async () => {
    setPrepError(null);
    if (!screening.strippedImageUri) { setPrepError("Apollo couldn't prepare this image. Nothing was sent."); return; }
    setBusy("Preparing image…");
    const base = { originalUri, cropped, text: screening.extractedText || null, screening };
    try {
      if (credentials.length === 0) {
        onComplete({ ...base, decision: screening.status === "ocr_unavailable" ? "not_checked" : "no_credentials_found", imageUri: screening.strippedImageUri, redactedRegions: 0 });
        return;
      }
      if (!captureViewRef.current) throw new Error("capture view missing");
      const uri = await captureRef(captureViewRef, { format: "jpg", quality: 0.85 });
      onComplete({ ...base, decision: "credentials_redacted", imageUri: uri, redactedRegions: credentials.length });
    } catch {
      setPrepError("This image appears to show a password, PIN or verification code, and Apollo couldn't black it out, so the image wasn't sent. Crop that part out and try again.");
    } finally {
      setBusy(null);
    }
  }, [screening, credentials.length, onComplete, originalUri, cropped]);

  const onCropped = useCallback(async (uri: string) => {
    setCropping(false); setPrepError(null); setBusy("Checking cropped image…");
    try { setScreening(await screenImage(uri, purpose)); setCropped(true); }
    catch { setPrepError("Apollo couldn't prepare the cropped image. Nothing was sent."); }
    finally { setBusy(null); }
  }, [purpose]);

  const sending = submissionState?.phase === "sending";
  const sendError = submissionState?.phase === "error" ? submissionState.errorMessage ?? "Upload failed." : null;
  const cropSource = screening.strippedImageUri;

  return (
    <>
      <ImageUploadWarning
        visible={visible && !cropping}
        onContinue={() => void prepare()}
        onCancel={onCancel}
        onCrop={cropSource && !sendError ? () => setCropping(true) : undefined}
        busyLabel={busy ?? (sending ? "Sending…" : null)}
        error={prepError ?? sendError}
        onRetry={sendError ? onRetrySubmission : prepError ? () => void prepare() : undefined}
        testID="image-upload-prep"
      />
      {cropSource ? (
        <ImageCropper visible={visible && cropping} uri={cropSource} width={dims.width} height={dims.height}
          onCancel={() => setCropping(false)} onDone={(uri) => void onCropped(uri)} />
      ) : null}
      {/* Off-screen copy at full size with black boxes over detected credentials; captureRef() produces the analysis copy. */}
      {visible && credentials.length > 0 && screening.strippedImageUri ? (
        <View pointerEvents="none" collapsable={false} style={{ position: "absolute", left: -10000, top: 0, opacity: 1 }}>
          <View ref={captureViewRef} collapsable={false} style={{ width: dims.width, height: dims.height }}>
            <Image source={{ uri: screening.strippedImageUri }} style={{ width: dims.width, height: dims.height }} resizeMode="stretch" />
            {credentials.map((r, i) => {
              const f = r.frame ?? { x: 0, y: 0, width: 0, height: 0 };
              return <View key={i} style={{ position: "absolute", left: f.x, top: f.y, width: f.width, height: f.height, backgroundColor: "#000000" }} />;
            })}
          </View>
        </View>
      ) : null}
    </>
  );
}
