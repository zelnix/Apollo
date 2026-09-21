/** Operational TTS batch bound, not a total narration limit. Reassembly preserves every character. */
export const SPEECH_SEGMENT_CHARACTERS = 1200;
export function speechSegments(text: string, limit = SPEECH_SEGMENT_CHARACTERS): string[] {
  const result: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const prefix = rest.slice(0, limit);
    const endings = [...prefix.matchAll(/[.!?](?:["')\]]*)\s+/g)];
    const last = endings[endings.length - 1];
    const split = last ? last.index! + last[0].length : Math.max(prefix.lastIndexOf(' ') + 1, 1);
    const length = split > 1 ? split : limit;
    result.push(rest.slice(0, length)); rest = rest.slice(length);
  }
  if (rest) result.push(rest);
  return result;
}