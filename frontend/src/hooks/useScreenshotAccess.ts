import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";

export function useScreenshotAccess(onGranted: () => Promise<void>) {
  const callback = useRef(onGranted);
  const waitingForSettings = useRef(false);
  const [permission, setPermission] = useState<ImagePicker.MediaLibraryPermissionResponse | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => { callback.current = onGranted; }, [onGranted]);

  const start = useCallback(async () => {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (current.granted) await callback.current();
    else setPermission(current);
  }, []);

  const continueAccess = useCallback(async () => {
    if (!permission) return;
    if (!permission.canAskAgain) {
      waitingForSettings.current = true;
      await Linking.openSettings();
      return;
    }
    setChecking(true);
    try {
      const next = await ImagePicker.requestMediaLibraryPermissionsAsync();
      setPermission(next.granted ? null : next);
      if (next.granted) await callback.current();
    } finally { setChecking(false); }
  }, [permission]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !waitingForSettings.current) return;
      waitingForSettings.current = false; setChecking(true);
      void ImagePicker.getMediaLibraryPermissionsAsync().then(async (next) => {
        setPermission(next.granted ? null : next);
        if (next.granted) await callback.current();
      }).finally(() => setChecking(false));
    });
    return () => subscription.remove();
  }, []);

  return { start, continueAccess, close: () => setPermission(null), permission, checking };
}