import Foundation

/// RFC 8785 canonicalization for the constrained rule-bundle domain.
///
/// Bundles are schema-restricted to strings, integers, booleans, null, arrays, objects
/// (floats rejected), so within this domain JCS is: keys sorted by UTF-16 code units,
/// minimal escaping (RFC 8785 §3.2.2.2), no whitespace, integers verbatim. Byte identity
/// with the Python `rfc8785` reference output is proven by RuleBundleVerifierParityTests
/// against security/test-vectors/jcs/canonical_bytes.hex.
public enum JCSCanonicalizer {
    public enum Error: Swift.Error { case unsupportedNumber, unsupportedValue }

    public static func canonicalData(_ value: Any) throws -> Data {
        var out = ""
        try write(value, into: &out)
        return Data(out.utf8)
    }

    private static func write(_ value: Any, into out: inout String) throws {
        switch value {
        case is NSNull:
            out += "null"
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { out += n.boolValue ? "true" : "false"; return }
            let d = n.doubleValue
            guard d == d.rounded(), abs(d) <= 9007199254740991 else { throw Error.unsupportedNumber }
            out += String(Int64(d))
        case let s as String:
            out += escape(s)
        case let a as [Any]:
            out += "["
            for (i, v) in a.enumerated() { if i > 0 { out += "," }; try write(v, into: &out) }
            out += "]"
        case let o as [String: Any]:
            let keys = o.keys.sorted { a, b in
                let ua = Array(a.utf16), ub = Array(b.utf16)
                for (x, y) in zip(ua, ub) where x != y { return x < y }
                return ua.count < ub.count
            }
            out += "{"
            for (i, k) in keys.enumerated() { if i > 0 { out += "," }; out += escape(k) + ":"; try write(o[k]!, into: &out) }
            out += "}"
        default:
            throw Error.unsupportedValue
        }
    }

    private static func escape(_ s: String) -> String {
        var r = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": r += "\\\""
            case "\\": r += "\\\\"
            case "\u{08}": r += "\\b"
            case "\u{09}": r += "\\t"
            case "\u{0A}": r += "\\n"
            case "\u{0C}": r += "\\f"
            case "\u{0D}": r += "\\r"
            default:
                if u.value < 0x20 { r += String(format: "\\u%04x", u.value) } else { r.unicodeScalars.append(u) }
            }
        }
        return r + "\""
    }
}
