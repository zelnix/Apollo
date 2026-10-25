// Full-screen crop tool: drag the corners or the box, then "Use crop". Produces a new cropped file;
// the original image is never modified.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Text, useWindowDimensions, View } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/ui";
import { fonts, makeStyles, spacing } from "@/src/theme";

const MIN = 48;
const HANDLE = 32;
function clamp(v: number, lo: number, hi: number) { "worklet"; return Math.min(Math.max(v, lo), hi); }

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: "#000000" },
  title: { fontFamily: fonts.displayBold, fontSize: 18, color: "#FFFFFF", textAlign: "center", paddingVertical: spacing.md },
  hint: { fontFamily: fonts.text, fontSize: 13, color: "#FFFFFF", opacity: 0.75, textAlign: "center", paddingHorizontal: spacing.xl },
  stage: { flex: 1, alignItems: "center", justifyContent: "center" },
  dim: { position: "absolute", backgroundColor: "rgba(0,0,0,0.6)" },
  box: { position: "absolute", borderWidth: 2, borderColor: "#FFFFFF" },
  handle: { position: "absolute", width: HANDLE, height: HANDLE, alignItems: "center", justifyContent: "center" },
  handleDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: c.brand },
  actions: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  error: { fontFamily: fonts.textMedium, fontSize: 14, color: "#FFFFFF", textAlign: "center", paddingTop: spacing.sm },
}));

export function ImageCropper({ visible, uri, width, height, onCancel, onDone }: {
  visible: boolean; uri: string; width: number; height: number;
  onCancel: () => void; onDone: (croppedUri: string) => void;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const areaW = win.width - spacing.xl * 2;
  const areaH = win.height - insets.top - insets.bottom - 220;
  const scale = Math.min(areaW / width, areaH / height);
  const dispW = width * scale; const dispH = height * scale;

  const x = useSharedValue(0); const y = useSharedValue(0);
  const w = useSharedValue(dispW); const h = useSharedValue(dispH);
  const start = useSharedValue({ x: 0, y: 0, w: 0, h: 0 });

  useEffect(() => {
    if (!visible) return;
    x.value = 0; y.value = 0; w.value = dispW; h.value = dispH; setError(null);
  }, [visible, uri, dispW, dispH]);

  const gestures = useMemo(() => {
    const begin = () => { "worklet"; start.value = { x: x.value, y: y.value, w: w.value, h: h.value }; };
    const corner = (left: boolean, top: boolean) => Gesture.Pan().onStart(begin).onUpdate((e) => {
      const s0 = start.value;
      if (left) { const nx = clamp(s0.x + e.translationX, 0, s0.x + s0.w - MIN); w.value = s0.w + (s0.x - nx); x.value = nx; }
      else w.value = clamp(s0.w + e.translationX, MIN, dispW - s0.x);
      if (top) { const ny = clamp(s0.y + e.translationY, 0, s0.y + s0.h - MIN); h.value = s0.h + (s0.y - ny); y.value = ny; }
      else h.value = clamp(s0.h + e.translationY, MIN, dispH - s0.y);
    });
    const move = Gesture.Pan().onStart(begin).onUpdate((e) => {
      const s0 = start.value;
      x.value = clamp(s0.x + e.translationX, 0, dispW - s0.w);
      y.value = clamp(s0.y + e.translationY, 0, dispH - s0.h);
    });
    return { tl: corner(true, true), tr: corner(false, true), bl: corner(true, false), br: corner(false, false), move };
  }, [dispW, dispH]);

  const boxStyle = useAnimatedStyle(() => ({ left: x.value, top: y.value, width: w.value, height: h.value }));
  const dimTop = useAnimatedStyle(() => ({ left: 0, top: 0, width: dispW, height: y.value }));
  const dimBottom = useAnimatedStyle(() => ({ left: 0, top: y.value + h.value, width: dispW, height: dispH - y.value - h.value }));
  const dimLeft = useAnimatedStyle(() => ({ left: 0, top: y.value, width: x.value, height: h.value }));
  const dimRight = useAnimatedStyle(() => ({ left: x.value + w.value, top: y.value, width: dispW - x.value - w.value, height: h.value }));
  const H = HANDLE / 2;
  const tlStyle = useAnimatedStyle(() => ({ left: x.value - H, top: y.value - H }));
  const trStyle = useAnimatedStyle(() => ({ left: x.value + w.value - H, top: y.value - H }));
  const blStyle = useAnimatedStyle(() => ({ left: x.value - H, top: y.value + h.value - H }));
  const brStyle = useAnimatedStyle(() => ({ left: x.value + w.value - H, top: y.value + h.value - H }));

  const apply = async () => {
    setBusy(true); setError(null);
    try {
      const crop = {
        originX: Math.round(x.value / scale), originY: Math.round(y.value / scale),
        width: Math.min(Math.round(w.value / scale), width), height: Math.min(Math.round(h.value / scale), height),
      };
      const out = await ImageManipulator.manipulateAsync(uri, [{ crop }], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
      onDone(out.uri);
    } catch {
      setError("ApolloSG couldn't crop this image. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <GestureHandlerRootView style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.md }]}>
        <View testID="image-cropper" style={{ flex: 1 }}>
          <Text style={s.title} accessibilityRole="header">Crop image</Text>
          <Text style={s.hint}>Drag the corners to keep only the part Apollo needs to see.</Text>
          <View style={s.stage}>
            <View style={{ width: dispW, height: dispH }}>
              <Image source={{ uri }} style={{ width: dispW, height: dispH }} resizeMode="stretch" />
              <Animated.View pointerEvents="none" style={[s.dim, dimTop]} />
              <Animated.View pointerEvents="none" style={[s.dim, dimBottom]} />
              <Animated.View pointerEvents="none" style={[s.dim, dimLeft]} />
              <Animated.View pointerEvents="none" style={[s.dim, dimRight]} />
              <GestureDetector gesture={gestures.move}>
                <Animated.View style={[s.box, boxStyle]} testID="image-cropper-box" />
              </GestureDetector>
              {([["tl", tlStyle], ["tr", trStyle], ["bl", blStyle], ["br", brStyle]] as const).map(([k, st]) => (
                <GestureDetector key={k} gesture={gestures[k]}>
                  <Animated.View style={[s.handle, st]} hitSlop={8} testID={`image-cropper-handle-${k}`}><View style={s.handleDot} /></Animated.View>
                </GestureDetector>
              ))}
            </View>
          </View>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <View style={s.actions}>
            <View style={{ flex: 1 }}><Button testID="image-cropper-cancel" variant="secondary" label="Cancel" onPress={onCancel} disabled={busy} /></View>
            <View style={{ flex: 1, justifyContent: "center" }}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Button testID="image-cropper-done" label="Use crop" onPress={() => void apply()} />}
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
