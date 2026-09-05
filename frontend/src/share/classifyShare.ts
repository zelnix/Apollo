// Share Into Apollo — decide which check a shared payload belongs to. Pure so it can be unit-tested.
// Order matters: files → email-looking text → account alerts → bare link → message.

export type ShareKind = "link" | "message" | "email" | "account" | "file" | "screenshot";
export interface SharedPayload { text?: string | null; webUrl?: string | null; files?: { path: string; mimeType?: string | null; fileName?: string | null; size?: number | null }[]; title?: string | null }
export interface ShareRoute { kind: ShareKind; pathname: "/check" | "/message" | "/email" | "/account" | "/file"; params: Record<string, string>; reason: string }

export const SHARE_KIND_LABEL: Record<ShareKind, string> = { link: "a link", message: "a text message or chat", email: "an email", account: "an account or login alert", file: "a file", screenshot: "a screenshot" };

const URL_RE = /https?:\/\/[^\s<>"']+/i;
const BARE_DOMAIN_RE = /\b[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s<>"']*)?/i;
const EMAIL_HEADER_RE = /^\s*(from|subject|to|reply-to|sent|date)\s*:/im;
const EMAIL_FORWARD_RE = /-{3,}\s*(forwarded|original) message\s*-{3,}|^begin forwarded message/im;
const EMAIL_BODY_RE = /\b(dear\b|kind regards|regards,|unsubscribe|view (this )?(email|message) in (your )?browser|sincerely)/i;
const ACCOUNT_RE = /\b(approve (this|the) (sign[- ]?in|login|request)|was this you|new (sign[- ]?in|login|device)|sign[- ]?in attempt|password (was )?(reset|changed)|reset your password|verification code|security code|one[- ]time (code|passcode)|two[- ]factor|2fa|unusual (sign[- ]?in|activity)|recovery (email|phone) (was )?(changed|added)|suspicious (login|sign[- ]?in|activity)|your account (was|has been) (accessed|locked))/i;

export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_RE) ?? text.match(BARE_DOMAIN_RE);
  return match ? match[0] : null;
}

export function classifyShare(p: SharedPayload): ShareRoute {
  const file = p.files?.[0];
  if (file) {
    const mime = (file.mimeType ?? "").toLowerCase();
    const name = file.fileName ?? file.path.split("/").pop() ?? "shared file";
    if (mime.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif)$/i.test(name)) return { kind: "screenshot", pathname: "/message", params: { imageUri: file.path, source: "share" }, reason: "It's an image — Apollo will read it as a screenshot of a message." };
    return { kind: "file", pathname: "/file", params: { uri: file.path, name, mime: file.mimeType ?? "", size: String(file.size ?? ""), source: "share" }, reason: "It's a file — Apollo checks what it really is before trusting the name." };
  }
  const raw = (p.text ?? "").trim();
  const url = p.webUrl?.trim() || extractUrl(raw);
  const withoutUrl = url ? raw.replace(url, "").trim() : raw;
  const headerHits = (raw.match(new RegExp(EMAIL_HEADER_RE.source, "gim")) ?? []).length;
  if (headerHits >= 2 || EMAIL_FORWARD_RE.test(raw) || (raw.length > 400 && EMAIL_BODY_RE.test(raw))) return { kind: "email", pathname: "/email", params: { text: raw.slice(0, 6000), source: "share" }, reason: headerHits >= 2 ? "It has email headers (From / Subject)." : "It reads like an email." };
  if (ACCOUNT_RE.test(raw)) return { kind: "account", pathname: "/account", params: { text: raw.slice(0, 4000), source: "share" }, reason: "It talks about a login, code or password change — Account Guard handles those." };
  if (url && withoutUrl.length < 12) return { kind: "link", pathname: "/check", params: { url: url.startsWith("http") ? url : `https://${url}`, source: "share" }, reason: "It's just a link." };
  return { kind: "message", pathname: "/message", params: { text: raw.slice(0, 4000), source: "share" }, reason: url ? "A message with a link inside — Apollo reads the wording first, then the link." : "It reads like a text or chat message." };
}

/** Alternatives the user can pick if Apollo guessed wrong (same payload, different check). */
export function alternativeRoutes(p: SharedPayload, chosen: ShareKind): ShareRoute[] {
  const raw = (p.text ?? "").trim();
  const url = p.webUrl?.trim() || extractUrl(raw);
  const all: ShareRoute[] = [];
  if (p.files?.[0]) {
    const f = p.files[0]; const name = f.fileName ?? f.path.split("/").pop() ?? "shared file";
    all.push({ kind: "file", pathname: "/file", params: { uri: f.path, name, mime: f.mimeType ?? "", size: String(f.size ?? ""), source: "share" }, reason: "" }, { kind: "screenshot", pathname: "/message", params: { imageUri: f.path, source: "share" }, reason: "" });
  } else {
    const body = raw || url || "";
    if (url) all.push({ kind: "link", pathname: "/check", params: { url: url.startsWith("http") ? url : `https://${url}`, source: "share" }, reason: "" });
    if (body) all.push({ kind: "message", pathname: "/message", params: { text: body.slice(0, 4000), source: "share" }, reason: "" }, { kind: "email", pathname: "/email", params: { text: body.slice(0, 6000), source: "share" }, reason: "" }, { kind: "account", pathname: "/account", params: { text: body.slice(0, 4000), source: "share" }, reason: "" });
  }
  return all.filter((r) => r.kind !== chosen);
}
