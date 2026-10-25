// Settings > App > "Show why each result was settled": one plain sentence on each result naming the rule
// that settled it. On by default; kept on this device only.
import { useEffect, useState } from "react";

import { storage } from "@/src/utils/storage";

const KEY = "apollo.settings.showResultReasons";
let cache: boolean | null = null;
const listeners = new Set<(value: boolean) => void>();

async function load(): Promise<boolean> {
  if (cache === null) cache = (await storage.getItem<boolean>(KEY, true)) !== false;
  return cache;
}

export async function setShowResultReasons(value: boolean): Promise<void> {
  cache = value;
  listeners.forEach((listener) => listener(value));
  await storage.setItem(KEY, value);
}

export function useShowResultReasons(): boolean {
  const [value, setValue] = useState<boolean>(cache ?? true);
  useEffect(() => {
    let alive = true;
    void load().then((v) => { if (alive) setValue(v); });
    listeners.add(setValue);
    return () => { alive = false; listeners.delete(setValue); };
  }, []);
  return value;
}
