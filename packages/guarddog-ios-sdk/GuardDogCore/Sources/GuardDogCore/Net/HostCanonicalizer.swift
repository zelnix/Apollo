import Foundation

/// Host canonicalization (Swift). Parity: security/test-vectors/normalization/host_vectors.json
/// trim -> strip one trailing dot -> IPv6 (validated, RFC 5952, bracketed) | IPv4 | NFC lowercase + punycode.
public enum HostCanonicalizer {
    static let labelRegex = try! NSRegularExpression(pattern: "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
    static let ipv4Regex = try! NSRegularExpression(pattern: "^(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")
    static let hex4Regex = try! NSRegularExpression(pattern: "^[0-9a-fA-F]{1,4}$")
    static let ipv6CharsRegex = try! NSRegularExpression(pattern: "^[0-9a-fA-F:.]+$")

    static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    public static func canonicalize(_ raw: String?) -> String? {
        guard let raw = raw else { return nil }
        var host = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if host.hasSuffix(".") { host.removeLast() }
        if host.isEmpty { return nil }
        if host.hasPrefix("[") && host.hasSuffix("]") { return canonicalizeIpv6(String(host.dropFirst().dropLast())) }
        if host.contains(":") { return canonicalizeIpv6(host) }
        if matches(ipv4Regex, host) { return host }

        let lowered = host.precomposedStringWithCanonicalMapping.lowercased()
        var out: [String] = []
        for label in lowered.split(separator: ".", omittingEmptySubsequences: false) {
            if label.isEmpty { return nil }
            let ascii = label.unicodeScalars.allSatisfy { $0.isASCII } ? String(label) : "xn--" + Punycode.encode(String(label))
            if !matches(labelRegex, ascii) { return nil }
            out.append(ascii)
        }
        let joined = out.joined(separator: ".")
        return joined.count > 253 ? nil : joined
    }

    /// Real IPv6 validation and RFC 5952 compression.
    public static func canonicalizeIpv6(_ literal: String) -> String? {
        guard matches(ipv6CharsRegex, literal) else { return nil }
        let halves = literal.components(separatedBy: "::")
        if halves.count > 2 { return nil }
        guard let head = expand(halves[0]) else { return nil }
        var tail: [Int] = []
        if halves.count == 2 { guard let t = expand(halves[1]) else { return nil }; tail = t }
        var groups: [Int]
        if halves.count == 2 {
            if head.count + tail.count > 7 { return nil }
            groups = head + Array(repeating: 0, count: 8 - head.count - tail.count) + tail
        } else {
            if head.count != 8 { return nil }
            groups = head
        }
        var bestStart = -1, bestLen = 0, i = 0
        while i < 8 {
            if groups[i] != 0 { i += 1; continue }
            var j = i
            while j < 8 && groups[j] == 0 { j += 1 }
            if j - i > bestLen { bestStart = i; bestLen = j - i }
            i = j
        }
        let hex: (Int) -> String = { String($0, radix: 16) }
        let text: String
        if bestLen >= 2 {
            text = groups[0..<bestStart].map(hex).joined(separator: ":") + "::" + groups[(bestStart + bestLen)...].map(hex).joined(separator: ":")
        } else {
            text = groups.map(hex).joined(separator: ":")
        }
        return "[\(text)]"
    }

    private static func expand(_ side: String) -> [Int]? {
        if side.isEmpty { return [] }
        let parts = side.components(separatedBy: ":")
        var out: [Int] = []
        for (idx, p) in parts.enumerated() {
            if p.contains(".") {
                guard idx == parts.count - 1, matches(ipv4Regex, p) else { return nil }
                let o = p.split(separator: ".").map { Int($0)! }
                out.append((o[0] << 8) | o[1]); out.append((o[2] << 8) | o[3])
            } else {
                guard matches(hex4Regex, p), let v = Int(p, radix: 16) else { return nil }
                out.append(v)
            }
        }
        return out
    }
}

/// RFC 3492 punycode encoder (encode-only; used for IDN labels).
enum Punycode {
    static func encode(_ input: String) -> String {
        let cps = input.unicodeScalars.map { Int($0.value) }
        var out = cps.filter { $0 < 128 }.map { String(UnicodeScalar($0)!) }.joined()
        let basic = out.count
        var h = basic
        if basic > 0 { out += "-" }
        var n = 128, delta = 0, bias = 72
        while h < cps.count {
            let m = cps.filter { $0 >= n }.min()!
            delta += (m - n) * (h + 1)
            n = m
            for c in cps {
                if c < n { delta += 1 }
                if c == n {
                    var q = delta
                    var k = 36
                    while true {
                        let t = k <= bias ? 1 : (k >= bias + 26 ? 26 : k - bias)
                        if q < t { break }
                        out.append(digit(t + (q - t) % (36 - t)))
                        q = (q - t) / (36 - t)
                        k += 36
                    }
                    out.append(digit(q))
                    bias = adapt(delta, h + 1, h == basic)
                    delta = 0
                    h += 1
                }
            }
            delta += 1
            n += 1
        }
        return out
    }

    private static func digit(_ d: Int) -> Character { Character(UnicodeScalar(d < 26 ? 97 + d : 22 + d)!) }

    private static func adapt(_ deltaIn: Int, _ numPoints: Int, _ first: Bool) -> Int {
        var delta = first ? deltaIn / 700 : deltaIn / 2
        delta += delta / numPoints
        var k = 0
        while delta > 455 { delta /= 35; k += 36 }
        return k + (36 * delta) / (delta + 38)
    }
}
