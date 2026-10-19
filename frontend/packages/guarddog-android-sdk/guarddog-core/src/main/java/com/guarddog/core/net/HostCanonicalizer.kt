package com.guarddog.core.net

import java.net.IDN
import java.text.Normalizer

/**
 * Host canonicalization (Kotlin). Parity: security/test-vectors/normalization/host_vectors.json
 * trim -> strip one trailing dot -> IPv6 (validated, RFC 5952 compressed, bracketed) |
 * IPv4 literal | NFC + lowercase + IDNA punycode; label/length validation.
 */
object HostCanonicalizer {
    private val labelRegex = Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
    private val ipv4Regex = Regex("^(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")
    private val hex4 = Regex("^[0-9a-fA-F]{1,4}$")
    private val ipv6Chars = Regex("^[0-9a-fA-F:.]+$")

    fun canonicalize(raw: String?): String? {
        if (raw == null) return null
        var host = raw.trim()
        if (host.endsWith(".")) host = host.dropLast(1)
        if (host.isEmpty()) return null
        if (host.startsWith("[") && host.endsWith("]")) return canonicalizeIpv6(host.substring(1, host.length - 1))
        if (host.contains(':')) return canonicalizeIpv6(host)
        if (ipv4Regex.matches(host)) return host

        val lowered = Normalizer.normalize(host, Normalizer.Form.NFC).lowercase()
        val labels = lowered.split('.')
        val out = ArrayList<String>(labels.size)
        for (label in labels) {
            if (label.isEmpty()) return null
            val ascii = if (label.all { it.code < 0x80 }) label else try {
                IDN.toASCII(label, IDN.ALLOW_UNASSIGNED).lowercase()
            } catch (e: IllegalArgumentException) {
                return null
            }
            if (!labelRegex.matches(ascii)) return null
            out.add(ascii)
        }
        val joined = out.joinToString(".")
        return if (joined.length > 253) null else joined
    }

    /** Real IPv6 validation (not `contains(":")`). Returns "[compressed]" or null. */
    fun canonicalizeIpv6(literal: String): String? {
        if (!ipv6Chars.matches(literal)) return null
        val halves = literal.split("::")
        if (halves.size > 2) return null
        val head = ArrayList<Int>()
        val tail = ArrayList<Int>()
        if (!expand(halves[0], head)) return null
        if (halves.size == 2 && !expand(halves[1], tail)) return null
        val groups: List<Int> = if (halves.size == 2) {
            if (head.size + tail.size > 7) return null
            head + List(8 - head.size - tail.size) { 0 } + tail
        } else {
            if (head.size != 8) return null
            head
        }
        var bestStart = -1
        var bestLen = 0
        var i = 0
        while (i < 8) {
            if (groups[i] != 0) { i++; continue }
            var j = i
            while (j < 8 && groups[j] == 0) j++
            if (j - i > bestLen) { bestStart = i; bestLen = j - i }
            i = j
        }
        val text = if (bestLen >= 2) {
            groups.subList(0, bestStart).joinToString(":") { Integer.toHexString(it) } + "::" +
                groups.subList(bestStart + bestLen, 8).joinToString(":") { Integer.toHexString(it) }
        } else {
            groups.joinToString(":") { Integer.toHexString(it) }
        }
        return "[$text]"
    }

    private fun expand(side: String, out: MutableList<Int>): Boolean {
        if (side.isEmpty()) return true
        val parts = side.split(':')
        for ((idx, p) in parts.withIndex()) {
            if (p.contains('.')) {
                if (idx != parts.lastIndex || !ipv4Regex.matches(p)) return false
                val o = p.split('.').map { it.toInt() }
                out.add((o[0] shl 8) or o[1]); out.add((o[2] shl 8) or o[3])
            } else {
                if (!hex4.matches(p)) return false
                out.add(p.toInt(16))
            }
        }
        return true
    }
}
