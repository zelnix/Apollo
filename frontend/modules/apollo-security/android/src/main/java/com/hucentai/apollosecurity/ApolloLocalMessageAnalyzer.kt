package com.hucentai.apollosecurity

import org.json.JSONArray
import org.json.JSONObject

/**
 * ApolloLocalMessageAnalyzer v1 — deterministic on-device scam-pattern detection.
 *
 * Runs immediately when a notification is captured, without internet access. Designed to catch
 * the most common and dangerous scam patterns (urgency + action demand, credential harvesting,
 * payment pressure, impersonation of institutions). This is NOT a replacement for the full
 * TypeScript analysis engine or Higgins' contextual assessment; it is a named, independent
 * first-pass analyzer with defined, auditable rules.
 *
 * Detection differences from the TypeScript `analyseMessage()` engine:
 *   - Does NOT perform link reputation checks (requires network).
 *   - Does NOT resolve lookalike domains or redirect chains.
 *   - Does NOT identify specific claimed brands from domain lists.
 *   - Does NOT evaluate sender/link domain mismatches.
 *   - Uses simpler keyword matching, not the TypeScript engine's weighted signal scoring.
 *   - May produce false positives on legitimate urgent messages from banks or services.
 *
 * Rule categories (each rule has a named identifier):
 *   LMA-U1: Urgency + action demand patterns
 *   LMA-C1: Credential harvesting patterns
 *   LMA-P1: Payment/financial pressure patterns
 *   LMA-I1: Institutional impersonation patterns
 *   LMA-L1: Suspicious URL patterns (structure only, no reputation)
 *   LMA-K1: Callback/contact manipulation patterns
 *
 * Result states:
 *   "growling" — multiple strong signals or one credential/payment signal with urgency
 *   "ears_up"  — single moderate signal
 *   "resting"  — no detection
 *
 * All results are marked with `source: "local_detection"` and `analyzer: "ApolloLocalMessageAnalyzer_v1"`.
 * The backend investigation projector produces the authoritative Higgins Patrol record separately.
 */
object ApolloLocalMessageAnalyzer {

  const val ANALYZER_NAME = "ApolloLocalMessageAnalyzer_v1"

  data class LocalFinding(
    val ruleId: String,
    val title: String,
    val detail: String,
  )

  data class AnalysisResult(
    val suspicious: Boolean,
    val state: String,           // "resting" | "ears_up" | "growling"
    val findings: List<LocalFinding>,
    val analyzer: String = ANALYZER_NAME,
    val source: String = "local_detection",
  ) {
    fun toJson(): JSONObject = JSONObject()
      .put("suspicious", suspicious)
      .put("state", state)
      .put("analyzer", analyzer)
      .put("source", source)
      .put("findings", JSONArray().also { arr -> findings.forEach { f ->
        arr.put(JSONObject().put("ruleId", f.ruleId).put("title", f.title).put("detail", f.detail))
      }})
  }

  /** Analyse a captured message. Pure function, no I/O, no network. */
  fun analyse(sender: String, text: String): AnalysisResult {
    val lower = text.lowercase()
    val senderLower = sender.lowercase()
    val findings = mutableListOf<LocalFinding>()

    // LMA-U1: Urgency + action demand
    val urgencyHits = URGENCY_PATTERNS.count { it.containsMatchIn(lower) }
    val actionHits = ACTION_PATTERNS.count { it.containsMatchIn(lower) }
    if (urgencyHits >= 1 && actionHits >= 1) {
      findings.add(LocalFinding("LMA-U1", "Urgency with action demand",
        "Message uses urgent language and asks you to take immediate action."))
    }

    // LMA-C1: Credential harvesting
    if (CREDENTIAL_PATTERNS.any { it.containsMatchIn(lower) }) {
      findings.add(LocalFinding("LMA-C1", "Credential request detected",
        "Message asks for login credentials, verification codes, PINs or passwords."))
    }

    // LMA-P1: Payment/financial pressure
    if (PAYMENT_PATTERNS.any { it.containsMatchIn(lower) }) {
      val hasUrgency = urgencyHits >= 1 || URGENCY_PATTERNS.any { it.containsMatchIn(lower) }
      findings.add(LocalFinding("LMA-P1", "Payment or financial pressure",
        if (hasUrgency) "Urgent demand involving money, payment or financial action."
        else "Message involves payment, transfer or financial action."))
    }

    // LMA-I1: Institutional impersonation (sender claims to be bank/gov/tech support)
    if (IMPERSONATION_PATTERNS.any { it.containsMatchIn(senderLower) || it.containsMatchIn(lower) }) {
      if (urgencyHits >= 1 || actionHits >= 1) {
        findings.add(LocalFinding("LMA-I1", "Possible institutional impersonation",
          "Message appears to impersonate a bank, government agency or service provider with an action demand."))
      }
    }

    // LMA-L1: Suspicious URL patterns (IP addresses, suspicious TLDs, very long URLs, URL shorteners)
    val urls = URL_PATTERN.findAll(text).toList()
    if (urls.any { url -> SUSPICIOUS_URL_PATTERNS.any { it.containsMatchIn(url.value) } }) {
      findings.add(LocalFinding("LMA-L1", "Suspicious link structure",
        "Message contains a link with a suspicious structure (IP address, unusual domain, or known shortener)."))
    }

    // LMA-K1: Callback/contact manipulation
    if (CALLBACK_PATTERNS.any { it.containsMatchIn(lower) }) {
      findings.add(LocalFinding("LMA-K1", "Callback or contact manipulation",
        "Message asks you to call a specific number, often claiming urgency or account problems."))
    }

    // Determine overall state
    val state = when {
      findings.isEmpty() -> "resting"
      findings.size >= 2 -> "growling"
      findings.any { it.ruleId in setOf("LMA-C1", "LMA-P1") } && urgencyHits >= 1 -> "growling"
      else -> "ears_up"
    }

    return AnalysisResult(suspicious = findings.isNotEmpty(), state = state, findings = findings)
  }

  // ---- Pattern definitions ----

  private val URGENCY_PATTERNS = listOf(
    Regex("""\b(urgent|immediately|right\s*now|act\s*now|expires?\s*(today|soon|in\s*\d))\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(within\s*\d+\s*(hour|minute|hr|min)|limited\s*time|final\s*(notice|warning|reminder))\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(suspend|deactivat|terminat|cancel|block|restrict|lock|clos)(ed|ing|ion)?\s*(your|the|this)?\s*(account|access|service)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(do\s*not\s*ignore|failure\s*to\s*(respond|comply|act)|must\s*(respond|act|verify|confirm))\b""", RegexOption.IGNORE_CASE),
  )

  private val ACTION_PATTERNS = listOf(
    Regex("""\b(click|tap|open|visit|go\s*to|follow)\s*(this|the|below|here|now)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(verify|confirm|update|secure|validate|unlock)\s*(your|the|this)?\s*(account|identity|information|details|password)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(log\s*in|sign\s*in|enter\s*(your|the))\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(call\s*(us|back|this\s*number)|reply\s*(with|to\s*this))\b""", RegexOption.IGNORE_CASE),
  )

  private val CREDENTIAL_PATTERNS = listOf(
    Regex("""\b(enter|provide|share|send|give|type)\s*(your|the|a)?\s*(password|passcode|pin|otp|verification\s*code|security\s*code|login)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(ssn|social\s*security|tax\s*file|medicare|driver.?s?\s*licen[sc]e)\s*(number|#)?\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(one[- ]?time\s*(code|password|passcode)|2fa|two[- ]?factor|mfa|authentication\s*code)\b""", RegexOption.IGNORE_CASE),
  )

  private val PAYMENT_PATTERNS = listOf(
    Regex("""\b(transfer|send|pay|wire|deposit)\s*(money|\$|aud|usd|gbp|eur|\d+[\s,]*\d*)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(bitcoin|crypto|gift\s*card|itunes\s*card|google\s*play\s*card|prepaid\s*card)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(bank\s*(transfer|deposit|details|account)|bsb|routing\s*number|swift|iban)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(overdue|outstanding|unpaid)\s*(balance|payment|invoice|bill|amount|fine|fee|tax)\b""", RegexOption.IGNORE_CASE),
  )

  private val IMPERSONATION_PATTERNS = listOf(
    Regex("""\b(your\s*bank|ato|tax\s*office|centrelink|medicare|myg[oa]v|services?\s*australia)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(apple\s*(id|support)|microsoft\s*(support|account)|google\s*(support|account)|amazon\s*(support|account))\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(police|federal|investigation|warrant|legal\s*action|court\s*order)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(tech\s*support|customer\s*(service|support)|help\s*desk)\b""", RegexOption.IGNORE_CASE),
  )

  private val URL_PATTERN = Regex("""(?i)\bhttps?://[^\s<>\]\["']+""")

  private val SUSPICIOUS_URL_PATTERNS = listOf(
    Regex("""https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}"""),                    // IP address URLs
    Regex("""\.(tk|ml|ga|cf|gq|buzz|top|xyz|icu|cam|rest|monster)/"""),            // Suspicious TLDs
    Regex("""(bit\.ly|tinyurl|t\.co|goo\.gl|is\.gd|rb\.gy|short\.io|cutt\.ly)"""), // URL shorteners
    Regex("""[a-z]{20,}\.(com|org|net)"""),                                        // Very long random domain
  )

  private val CALLBACK_PATTERNS = listOf(
    Regex("""\b(call|ring|phone|dial|contact)\s*(us|me|this|the)\s*(number|#|immediately|now|back|asap)\b""", RegexOption.IGNORE_CASE),
    Regex("""\b(reply\s*(stop|yes|no|with|to\s*confirm))\b""", RegexOption.IGNORE_CASE),
  )
}
