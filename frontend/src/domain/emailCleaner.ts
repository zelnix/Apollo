/**
 * Cleans raw email content (HTML, tracking URLs, encoded text) into
 * readable plain text for display, while preserving enough structure
 * for the backend analysis engine.
 */

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  let text = html
    // Remove style/script blocks entirely
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    // Block-level elements → newline
    .replace(/<\/?(div|p|br|tr|li|h[1-6]|blockquote|section|article|header|footer|table|thead|tbody|hr)[^>]*>/gi, "\n")
    // Remove all remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-zA-Z]+;/g, " ");
  return text;
}

/** Shorten or remove long tracking/encoded URLs. */
function cleanUrls(text: string): string {
  return text.replace(
    /https?:\/\/[^\s)>\]]{120,}/g,
    (url) => {
      // Try to extract the actual destination from common redirect patterns
      const destMatch = url.match(/[?&](?:url|redirect|dest|href|link|r|u)=([^&]+)/i);
      if (destMatch) {
        try {
          const decoded = decodeURIComponent(destMatch[1]);
          if (decoded.startsWith("http")) return decoded.split("?")[0];
        } catch { /* keep shortened */ }
      }
      // Shorten to domain + path hint
      try {
        const parsed = new URL(url);
        const path = parsed.pathname.length > 30
          ? parsed.pathname.slice(0, 27) + "..."
          : parsed.pathname;
        return `${parsed.origin}${path}`;
      } catch {
        return url.slice(0, 60) + "...";
      }
    },
  );
}

/** Collapse excessive whitespace. */
function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove common email boilerplate/noise. */
function removeBoilerplate(text: string): string {
  return text
    // Tracking pixel alt text
    .replace(/\[image[:\s]*[^\]]*\]/gi, "")
    // Unsubscribe footer noise
    .replace(/if you no longer wish to receive.*$/gim, "")
    .replace(/to unsubscribe.*$/gim, "[Unsubscribe link]")
    // Base64 blobs that leaked through
    .replace(/[A-Za-z0-9+/=]{100,}/g, "[encoded content]")
    // Empty link text artifacts
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "");
}

/**
 * Clean raw email content for human-readable display.
 * Returns the cleaned text. The original raw content should still be
 * sent to the backend for full analysis.
 */
export function cleanEmailForDisplay(raw: string): string {
  if (!raw || raw.length < 10) return raw;

  let text = raw;

  // Detect HTML content
  const isHtml = /<(?:html|head|body|div|p|span|table|tr|td|a |br|img)\b/i.test(text);
  if (isHtml) {
    text = stripHtml(text);
  }

  text = cleanUrls(text);
  text = removeBoilerplate(text);
  text = normalizeWhitespace(text);

  return text;
}
