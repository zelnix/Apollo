/** The apps a message commonly arrives in. The person names it; Apollo never guesses.
 *  Only asked for content shared in from another app — a message pasted in by hand carries no
 *  reliable origin, and Apollo would rather record nothing than record a guess. */
export const SOURCE_APPS = ["SMS", "WhatsApp", "Messenger", "iMessage", "Telegram", "Instagram"] as const;

/** The header line Apollo's capture flows and evidence presentation already read. */
export function withSourceApp(text: string, app: string | null): string {
  if (!app || !text || /^source app:/im.test(text)) return text;
  return `Source app: ${app}\n${text}`;
}
