import Foundation

/// URL sanitization (Swift). Parity: security/test-vectors/normalization/url_vectors.json
/// The original candidate stays analyzable; `sanitizedUrl` = scheme://canonicalHost + path only.
public struct ParsedCandidateUrl: Equatable {
    public let original: String
    public let scheme: String
    public let host: String
    public let path: String
    public let hadUserinfo: Bool
    public let hadQuery: Bool
    public let hadFragment: Bool
    public var sanitizedUrl: String { "\(scheme)://\(host)\(path)" }
}

public enum UrlSanitizer {
    static let urlRegex = try! NSRegularExpression(pattern: "^([a-zA-Z][a-zA-Z0-9+.-]*)://([^/?#]*)([^?#]*)(\\?[^#]*)?(#.*)?$")
    static let digitsRegex = try! NSRegularExpression(pattern: "^\\d*$")

    public static func sanitize(_ raw: String) -> ParsedCandidateUrl? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let ns = trimmed as NSString
        guard let m = urlRegex.firstMatch(in: trimmed, range: NSRange(location: 0, length: ns.length)) else { return nil }
        func group(_ i: Int) -> String { let r = m.range(at: i); return r.location == NSNotFound ? "" : ns.substring(with: r) }
        let scheme = group(1).lowercased()
        guard scheme == "http" || scheme == "https" else { return nil }
        var authority = group(2)
        let hadUserinfo = authority.contains("@")
        if hadUserinfo, let at = authority.range(of: "@", options: .backwards) { authority = String(authority[at.upperBound...]) }
        let hostPart: String
        if authority.hasPrefix("[") {
            guard let end = authority.firstIndex(of: "]") else { return nil }
            hostPart = String(authority[...end])
            let rest = String(authority[authority.index(after: end)...])
            if !rest.isEmpty && !(rest.hasPrefix(":") && HostCanonicalizer.matches(digitsRegex, String(rest.dropFirst()))) { return nil }
        } else if let colon = authority.range(of: ":", options: .backwards) {
            hostPart = String(authority[..<colon.lowerBound])
            if !HostCanonicalizer.matches(digitsRegex, String(authority[colon.upperBound...])) { return nil }
        } else {
            hostPart = authority
        }
        guard let host = HostCanonicalizer.canonicalize(hostPart) else { return nil }
        let path = group(3).isEmpty ? "/" : group(3)
        return ParsedCandidateUrl(original: raw, scheme: scheme, host: host, path: path, hadUserinfo: hadUserinfo,
                                  hadQuery: !group(4).isEmpty, hadFragment: !group(5).isEmpty)
    }
}
