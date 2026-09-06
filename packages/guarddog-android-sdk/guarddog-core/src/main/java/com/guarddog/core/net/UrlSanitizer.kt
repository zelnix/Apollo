package com.guarddog.core.net

/**
 * URL sanitization (Kotlin). Parity: security/test-vectors/normalization/url_vectors.json
 *
 * The ORIGINAL candidate stays available for local analysis. The share-safe form is
 * `scheme://canonicalHost + path` - no userinfo, no port, no query, no fragment.
 * Only `sanitizedUrl` may appear in SecurityEvent or leave the device.
 */
data class ParsedCandidateUrl(
    val original: String,
    val scheme: String,
    val host: String,
    val path: String,
    val hadUserinfo: Boolean,
    val hadQuery: Boolean,
    val hadFragment: Boolean,
) {
    val sanitizedUrl: String get() = "$scheme://$host$path"
}

object UrlSanitizer {
    private val urlRegex = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*)://([^/?#]*)([^?#]*)(\\?[^#]*)?(#.*)?$")
    private val digits = Regex("^\\d*$")

    fun sanitize(raw: String): ParsedCandidateUrl? {
        val m = urlRegex.matchEntire(raw.trim()) ?: return null
        val scheme = m.groupValues[1].lowercase()
        if (scheme != "http" && scheme != "https") return null
        var authority = m.groupValues[2]
        val hadUserinfo = authority.contains('@')
        if (hadUserinfo) authority = authority.substring(authority.lastIndexOf('@') + 1)
        val hostPart: String
        if (authority.startsWith("[")) {
            val end = authority.indexOf(']')
            if (end < 0) return null
            hostPart = authority.substring(0, end + 1)
            val rest = authority.substring(end + 1)
            if (rest.isNotEmpty() && !(rest.startsWith(":") && digits.matches(rest.substring(1)))) return null
        } else {
            val colon = authority.lastIndexOf(':')
            hostPart = if (colon >= 0) authority.substring(0, colon) else authority
            if (colon >= 0 && !digits.matches(authority.substring(colon + 1))) return null
        }
        val host = HostCanonicalizer.canonicalize(hostPart) ?: return null
        val path = m.groupValues[3].ifEmpty { "/" }
        return ParsedCandidateUrl(
            original = raw,
            scheme = scheme,
            host = host,
            path = path,
            hadUserinfo = hadUserinfo,
            hadQuery = m.groupValues[4].isNotEmpty(),
            hadFragment = m.groupValues[5].isNotEmpty(),
        )
    }
}
