// Gate 6 — File & Content Engine (on-device). Trust the file itself, not its name:
// magic bytes vs extension, double/RTL-trick extensions, archives, packages, profiles/certs,
// embedded URLs. Never claims "100% safe"; unknown ≠ malicious.

import type { ApolloState } from "./types";

export type FileSource = "email" | "message" | "browser" | "cloud" | "nearby" | "known" | "unknown";
export const FILE_SOURCES: { id: FileSource; label: string }[] = [
  { id: "known", label: "Someone I know" }, { id: "email", label: "Email attachment" }, { id: "message", label: "Text / chat" }, { id: "browser", label: "Website download" },
  { id: "cloud", label: "Shared drive link" }, { id: "nearby", label: "AirDrop / Nearby Share" }, { id: "unknown", label: "Not sure" },
];

export type RealType = "pdf" | "image" | "office" | "office_macro" | "zip" | "rar" | "7z" | "apk" | "exe" | "script" | "profile" | "certificate" | "text" | "audio_video" | "unknown";
export interface FileInput { name: string; size?: number; mime?: string | null; headBytes?: Uint8Array | null; textSample?: string | null; source: FileSource; passwordInMessage?: boolean }
export interface FileAnalysis { scenario: string; title: string; state: ApolloState; verdict: string; why: string[]; recommendation: string; realType: RealType; claimedType: string; urls: string[]; handoff: "app" | "network" | "web" | "none"; technical: string[] }

const DANGEROUS_EXT = new Set(["exe", "scr", "bat", "cmd", "com", "pif", "msi", "js", "jse", "vbs", "vbe", "ps1", "wsf", "hta", "jar", "sh", "lnk", "dll"]);
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "odt"]);
const IMG_EXT = new Set(["jpg", "jpeg", "png", "gif", "heic", "webp", "bmp", "svg"]);
const MEDIA_EXT = new Set(["mp3", "mp4", "mov", "m4a", "wav", "avi", "mkv"]);

export function realTypeFromBytes(b?: Uint8Array | null, mime?: string | null): RealType {
  if (b && b.length >= 4) {
    const h = Array.from(b.slice(0, 8)).map((x) => x.toString(16).padStart(2, "0")).join("");
    if (h.startsWith("25504446")) return "pdf";
    if (h.startsWith("4d5a")) return "exe";
    if (h.startsWith("7f454c46")) return "exe";
    if (h.startsWith("cafebabe") || h.startsWith("feedface") || h.startsWith("feedfacf")) return "exe";
    if (h.startsWith("504b0304")) return "zip"; // zip / docx / apk — refined by name below
    if (h.startsWith("52617221")) return "rar";
    if (h.startsWith("377abcaf")) return "7z";
    if (h.startsWith("d0cf11e0")) return "office";
    if (h.startsWith("ffd8ff") || h.startsWith("89504e47") || h.startsWith("47494638") || h.startsWith("52494646")) return "image";
    if (h.startsWith("3c3f786d6c") || h.startsWith("3c706c6973")) return "profile"; // <?xml / <plist
    if (h.startsWith("2d2d2d2d2d424547")) return "certificate"; // -----BEG
    if (h.startsWith("2321")) return "script"; // #!
  }
  if (mime) {
    if (mime.includes("pdf")) return "pdf"; if (mime.startsWith("image/")) return "image"; if (mime.includes("zip")) return "zip";
    if (mime.includes("android.package")) return "apk"; if (mime.includes("x-apple-aspen-config") || mime.includes("mobileconfig")) return "profile";
    if (mime.includes("x-x509") || mime.includes("pkix-cert")) return "certificate"; if (mime.startsWith("text/")) return "text";
    if (mime.startsWith("audio/") || mime.startsWith("video/")) return "audio_video"; if (mime.includes("officedocument") || mime.includes("msword") || mime.includes("ms-excel")) return "office";
    if (mime.includes("x-msdownload") || mime.includes("x-executable") || mime.includes("x-sh") || mime.includes("javascript")) return "exe";
  }
  return "unknown";
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]{4,}/gi;

export function analyseFile(f: FileInput): FileAnalysis {
  const rawName = f.name;
  const rtl = /[\u202e\u202b\u200f]/.test(rawName);
  const name = rawName.replace(/[\u202a-\u202e\u200e\u200f]/g, "");
  const parts = name.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  const inner = parts.length > 2 ? parts[parts.length - 2] : "";
  const doubleExt = parts.length > 2 && (DOC_EXT.has(inner) || IMG_EXT.has(inner)) && DANGEROUS_EXT.has(ext);
  let real = realTypeFromBytes(f.headBytes, f.mime);
  if (real === "zip" && ext === "apk") real = "apk";
  if (real === "zip" && ["docx", "xlsx", "pptx", "docm", "xlsm", "pptm"].includes(ext)) real = /m$/.test(ext) ? "office_macro" : "office";
  if (real === "unknown" && (ext === "docm" || ext === "xlsm" || ext === "pptm")) real = "office_macro";
  if (real === "unknown" && ext === "apk") real = "apk";
  if (real === "unknown" && (ext === "mobileconfig" || ext === "plist")) real = "profile";
  if (real === "unknown" && ["cer", "crt", "pem", "der", "p12", "pfx"].includes(ext)) real = "certificate";
  if (real === "unknown" && DANGEROUS_EXT.has(ext)) real = ext === "exe" || ext === "msi" || ext === "scr" || ext === "com" || ext === "pif" || ext === "dll" ? "exe" : "script";
  if (real === "unknown" && ext === "pdf" && !f.headBytes) real = "pdf";
  if (real === "unknown" && IMG_EXT.has(ext) && !f.headBytes) real = "image";
  if (real === "unknown" && MEDIA_EXT.has(ext)) real = "audio_video";
  if (real === "unknown" && (ext === "zip" || ext === "rar" || ext === "7z") && !f.headBytes) real = ext as RealType;
  const claimedType = ext ? ext.toUpperCase() : "no extension";
  const urls = Array.from(new Set(((f.textSample ?? "").match(URL_RE) ?? []).map((u) => u.replace(/[.,;:)]+$/, "")))).slice(0, 10);
  const technical = [`Name: ${name}`, `Extension: ${claimedType}`, `Real type (signature/MIME): ${real}`, f.mime ? `MIME: ${f.mime}` : "", f.size ? `Size: ${Math.round(f.size / 1024)} KB` : "", rtl ? "Contains right-to-left override characters" : "", urls.length ? `Embedded links: ${urls.length}` : ""].filter(Boolean);
  const unexpected = f.source === "unknown" || f.source === "message" || f.source === "nearby";
  const R = (scenario: string, title: string, state: ApolloState, verdict: string, why: string[], recommendation: string, handoff: FileAnalysis["handoff"] = "none"): FileAnalysis => ({ scenario, title, state, verdict, why, recommendation, realType: real, claimedType, urls, handoff, technical });

  const looksDoc = DOC_EXT.has(ext) || IMG_EXT.has(ext) || DOC_EXT.has(inner) || IMG_EXT.has(inner);
  if ((real === "exe" || real === "script") && (looksDoc || doubleExt || rtl)) return R("F01", "Disguised executable", "barking", `This file is not really a ${DOC_EXT.has(inner) || DOC_EXT.has(ext) ? (inner || ext).toUpperCase() : "document"}. Don't open it.`, [`Its name suggests a ${inner ? inner.toUpperCase() : ext.toUpperCase()} file.`, "Its actual type is executable content.", rtl ? "The name uses hidden characters to disguise its real extension." : unexpected ? "It came from an unexpected source." : "Documents never need to be executable."], "Delete it unless you can independently verify the sender. Don't 'open with' anything.");
  if (real === "exe" || real === "script" || doubleExt) return R("F13", "Executable or script", unexpected ? "barking" : "growling", "This is a program or script, not a document.", ["Running it gives it control of your device.", unexpected ? "It arrived from a source you didn't expect." : "Only run programs you deliberately downloaded from an official store or vendor.", "Phones don't need .exe/.bat/.js files from messages or emails."], "Don't open or run it. Delete it.", "app");
  if (real === "apk") return R("F02", "Android app package (APK)", /update|whatsapp|bank|netflix|telstra|auspost/i.test(name) || unexpected ? "barking" : "growling", /update/i.test(name) ? "Apps never update through a file someone sends you." : "This installs an app outside the Play Store.", ["Sideloaded apps skip Google Play's checks.", /whatsapp|bank|netflix|telstra|auspost/i.test(name) ? "The name impersonates a well-known app." : "Apollo can't see what permissions it will ask for until installed.", unexpected ? "It came from a message, website or unknown source." : "Only install from a developer you trust."], "Don't install it. Get apps from the Play Store. If you already installed it, use the recovery steps.", "app");
  if (real === "profile" || real === "certificate") return R(real === "profile" ? "F11" : "F12", real === "profile" ? "Configuration profile" : "Trust certificate", f.source === "known" ? "growling" : "barking", real === "profile" ? "This file can change how your device is managed or how its network traffic is handled." : "This file can make your device trust a stranger's certificates — letting them read secure traffic.", ["It changes device trust or network settings, not just a document.", "Legitimate ones come from your employer's IT or your own VPN provider, never from messages.", unexpected ? "It arrived unexpectedly." : "Only install if you asked for it and know exactly who sent it."], "Don't install. If you already did, remove it in Settings → General → VPN & Device Management (iOS) or Security (Android).", "network");
  if (real === "zip" || real === "rar" || real === "7z") {
    const pw = !!f.passwordInMessage;
    return R(pw ? "F04" : "F03", pw ? "Password-protected archive" : "Archive", pw ? "ears_up" : unexpected ? "growling" : "ears_up", pw ? "A password sent alongside an archive is often used to sneak it past scanners." : "Archives can hide programs inside document-looking names.", [pw ? "The password came in the same message as the file." : "Apollo can't see inside this archive on this device.", unexpected ? "It came from an unexpected source." : "Not every archive is dangerous.", "Check each file's real type after extracting — especially .exe, .js, .scr, .lnk."], "Don't extract it unless you expected it. Never run anything inside it.");
  }
  if (real === "office_macro") return R("F08", "Macro-enabled document", unexpected ? "growling" : "ears_up", "This document can run macros (active content).", ["Macro-enabled files (.docm/.xlsm) can run code when opened.", unexpected ? "It came from an unexpected source." : "Some businesses use macros legitimately.", "Apollo can't confirm what the macro does."], "Open only in protected view / with macros disabled, and only if you expected it.");
  if (urls.length) return R(/invoice|statement|receipt|payment|overdue/i.test(name) ? "F05" : "F06", /invoice|statement|receipt|payment|overdue/i.test(name) ? "Invoice with links" : "Document with links", "ears_up", "This document contains links. Apollo will check where they lead before you tap them.", [`${urls.length} link${urls.length > 1 ? "s" : ""} found inside.`, /invoice|statement|payment|overdue/i.test(name) ? "Invoices with changed bank details or urgent payment links are a common scam." : "Links inside documents skip your email's link filters.", "Check each link with Apollo before opening."], "Don't pay or log in via links in the document until Apollo has checked them.", "web");
  if (real === "pdf" || real === "office" || real === "image" || real === "text" || real === "audio_video") return R("F10", "Ordinary file", f.source === "nearby" ? "ears_up" : "resting", "I didn't find any obvious signs of danger.", [`Real type matches its name (${real}).`, "No executable content, macros or links detected.", f.source === "nearby" ? "It arrived from a nearby device you may not know — preview before opening." : "Apollo can't guarantee any file is 100% safe — this is what it could see."], f.source === "nearby" ? "Preview it first. Delete it if you weren't expecting anything." : "Fine to open. Come back to Apollo if it asks you to enable anything.");
  return R("F16", "Unknown file type", "ears_up", "I don't know this file type well yet.", [`Extension ${claimedType} isn't one Apollo recognises.`, "No malicious signs detected — but no way to confirm it's harmless either.", unexpected ? "It came from an unexpected source." : "Ask the sender what it is before opening."], "Don't open it unless you know exactly what it is and who sent it.");
}
