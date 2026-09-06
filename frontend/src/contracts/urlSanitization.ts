// App-facing contract: URL sanitization. Local analysis uses the full parsed candidate;
// only `sanitizedUrl` (scheme + canonical host + path) may be shared or logged.
export { sanitizeUrl, type ParsedCandidateUrl } from "./shared/normalization.ts";
