// Font size that keeps a header title on one line in the width the header's icons leave free.
// Outfit Bold averages just under half an em per character; 0.5 keeps a little slack.
const EM_PER_CHAR = 0.5;

export function fittedSize(text: string, available: number, maxSize: number, minSize: number): number {
  if (!available || !text) return maxSize;
  return Math.max(minSize, Math.min(maxSize, Math.floor(available / (text.length * EM_PER_CHAR))));
}
