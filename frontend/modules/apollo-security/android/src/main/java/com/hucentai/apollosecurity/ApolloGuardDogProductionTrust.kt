package com.hucentai.apollosecurity

import android.content.Context
import android.content.pm.PackageManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.JsonReader
import android.util.JsonToken
import com.guarddog.core.rules.RuleBundleVerifier
import com.guarddog.core.rules.TrustedKeyRegistry
import org.json.JSONArray
import org.json.JSONObject
import java.io.StringReader
import java.security.KeyStore
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey

internal data class GuardDogRootConfig(
  val domain: String, val profile: String, val primaryId: String, val primaryKey: String,
  val recoveryId: String, val recoveryKey: String,
)

internal data class GuardDogOrdinaryKey(
  val id: String, val publicKey: String, val validFrom: Instant, val validUntil: Instant, val status: String,
)

internal data class GuardDogTrustState(
  val generation: Long, val version: Long, val authority: String, val rootKeyId: String, val expiresAt: Instant,
  val envelopeHash: String, val keys: List<GuardDogOrdinaryKey>, val disabledPrimaryRoots: Set<String>,
  val recoveryFloor: Long, val signedManifest: String, val signedRuleBundle: String?,
) {
  fun activeKeys(now: Instant = Instant.now()): List<GuardDogOrdinaryKey> = keys.filter { it.status == "active" && !now.isBefore(it.validFrom) && now.isBefore(it.validUntil) }
  fun current(now: Instant = Instant.now()): Boolean = now.isBefore(expiresAt) && activeKeys(now).isNotEmpty()
}

internal data class StagedTrustManifest(val state: GuardDogTrustState, val changed: Boolean)

/** Detect duplicate JSON members before JSONObject can collapse them. */
private object DuplicateJsonGuard {
  fun check(raw: String) = JsonReader(StringReader(raw)).use { reader -> read(reader); check(reader.peek() == JsonToken.END_DOCUMENT) }
  private fun read(reader: JsonReader) {
    when (reader.peek()) {
      JsonToken.BEGIN_OBJECT -> { reader.beginObject(); val names = mutableSetOf<String>(); while (reader.hasNext()) { val name = reader.nextName(); check(names.add(name)) { "duplicate JSON member: $name" }; read(reader) }; reader.endObject() }
      JsonToken.BEGIN_ARRAY -> { reader.beginArray(); while (reader.hasNext()) read(reader); reader.endArray() }
      JsonToken.STRING -> reader.nextString(); JsonToken.NUMBER -> reader.nextString(); JsonToken.BOOLEAN -> reader.nextBoolean(); JsonToken.NULL -> reader.nextNull()
      else -> error("invalid JSON token")
    }
  }
}

/** HMAC-bound, no-backup state. A missing/replaced keystore key fails closed rather than resetting rollback history. */
private class GuardDogIntegrityStore(private val context: Context) {
  private val prefs = context.getSharedPreferences("apollo_guarddog_production_trust", Context.MODE_PRIVATE)
  fun load(): GuardDogTrustState? {
    val payload = prefs.getString("payload", null) ?: return null
    val savedMac = prefs.getString("mac", null) ?: error("GuardDog trust state has no integrity tag")
    val actual = mac(payload)
    check(MessageDigest.isEqual(Base64.getDecoder().decode(savedMac), actual)) { "GuardDog trust state integrity check failed" }
    return decode(JSONObject(payload))
  }
  fun save(state: GuardDogTrustState) {
    val payload = encode(state).toString()
    val tag = Base64.getEncoder().encodeToString(mac(payload))
    check(prefs.edit().putString("payload", payload).putString("mac", tag).commit()) { "Could not persist GuardDog trust state" }
  }
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY).setDigests(KeyProperties.DIGEST_SHA256).build())
    }.generateKey()
  }
  private fun mac(payload: String): ByteArray = Mac.getInstance("HmacSHA256").run { init(key()); doFinal(payload.toByteArray()) }
  private fun encode(state: GuardDogTrustState) = JSONObject().put("generation", state.generation).put("version", state.version).put("authority", state.authority)
    .put("rootKeyId", state.rootKeyId).put("expiresAt", state.expiresAt.toString()).put("envelopeHash", state.envelopeHash)
    .put("keys", JSONArray(state.keys.map { JSONObject().put("id", it.id).put("publicKey", it.publicKey).put("validFrom", it.validFrom.toString()).put("validUntil", it.validUntil.toString()).put("status", it.status) }))
    .put("disabledPrimaryRoots", JSONArray(state.disabledPrimaryRoots.toList())).put("recoveryFloor", state.recoveryFloor)
    .put("signedManifest", state.signedManifest).put("signedRuleBundle", state.signedRuleBundle ?: JSONObject.NULL)
  private fun decode(body: JSONObject): GuardDogTrustState {
    val keys = body.getJSONArray("keys"); val decoded = (0 until keys.length()).map { keys.getJSONObject(it) }.map {
      GuardDogOrdinaryKey(it.getString("id"), it.getString("publicKey"), Instant.parse(it.getString("validFrom")), Instant.parse(it.getString("validUntil")), it.getString("status"))
    }
    val disabled = body.getJSONArray("disabledPrimaryRoots")
    return GuardDogTrustState(body.getLong("generation"), body.getLong("version"), body.getString("authority"), body.getString("rootKeyId"),
      Instant.parse(body.getString("expiresAt")), body.getString("envelopeHash"), decoded, (0 until disabled.length()).map { disabled.getString(it) }.toSet(),
      body.getLong("recoveryFloor"), body.getString("signedManifest"), if (body.isNull("signedRuleBundle")) null else body.getString("signedRuleBundle"))
  }
  companion object { private const val KEY_ALIAS = "apollo_guarddog_production_state_hmac_v1" }
}

internal class ApolloGuardDogProductionTrust(private val context: Context) {
  private val store = GuardDogIntegrityStore(context)
  val roots: GuardDogRootConfig by lazy { rootsFromManifest() }
  fun current(): GuardDogTrustState? = store.load()

  fun stage(raw: String): StagedTrustManifest {
    DuplicateJsonGuard.check(raw)
    val root = JSONObject(raw); exactKeys(root, setOf("schemaVersion", "domain", "profile", "authority", "generation", "manifestVersion", "issuedAt", "expiresAt", "rootKeyId", "keys", "disabledPrimaryRootIds", "signature"))
    check(root.getString("schemaVersion") == "1.0" && root.getString("domain") == roots.domain && root.getString("profile") == roots.profile) { "trust manifest domain/profile mismatch" }
    val authority = root.getString("authority"); check(authority in setOf("primary", "recovery")) { "invalid trust authority" }
    val rootId = root.getString("rootKeyId"); val expectedId = if (authority == "primary") roots.primaryId else roots.recoveryId
    val expectedKey = if (authority == "primary") roots.primaryKey else roots.recoveryKey
    check(rootId == expectedId) { "unexpected trust root" }
    val now = Instant.now(); val issued = Instant.parse(root.getString("issuedAt")); val expires = Instant.parse(root.getString("expiresAt"))
    check(!issued.isAfter(now) && expires.isAfter(now)) { "trust manifest is not currently valid" }
    val generation = root.getLong("generation"); val version = root.getLong("manifestVersion"); check(generation > 0 && version > 0)
    val unsigned = JSONObject(root.toString()).apply { remove("signature") }
    val message = RuleBundleVerifier.canonical(unsigned.toString()); val signature = root.getString("signature")
    val publicKey = Base64.getDecoder().decode(expectedKey); check(publicKey.size == 32 && RuleBundleVerifier.verifyEd25519(publicKey, message, signature)) { "trust manifest signature invalid" }
    val current = current(); val disabled = current?.disabledPrimaryRoots.orEmpty().toMutableSet()
    val requestedDisabled = stringSet(root.getJSONArray("disabledPrimaryRootIds"))
    if (authority == "primary") check(requestedDisabled.isEmpty() && rootId !in disabled && generation > (current?.recoveryFloor ?: 0)) { "primary authority is disabled or below recovery floor" }
    else disabled.addAll(requestedDisabled.also { check(it.all { id -> id == roots.primaryId }) { "recovery may disable only pinned primary roots" } })
    val envelopeHash = MessageDigest.getInstance("SHA-256").digest(RuleBundleVerifier.canonical(root.toString())).joinToString("") { "%02x".format(it) }
    if (current != null) {
      check(generation >= current.generation) { "trust generation rollback" }
      if (generation == current.generation) {
        check(version >= current.version) { "trust manifest version rollback" }
        if (version == current.version) check(envelopeHash == current.envelopeHash) { "trust manifest version conflict" }
      }
    }
    val keys = parseKeys(root.getJSONArray("keys"), issued, expires)
    val floor = if (authority == "recovery") maxOf(current?.recoveryFloor ?: 0, generation) else current?.recoveryFloor ?: 0
    val state = GuardDogTrustState(generation, version, authority, rootId, expires, envelopeHash, keys, disabled, floor, raw, null)
    return StagedTrustManifest(state, current?.envelopeHash != envelopeHash)
  }

  fun commit(staged: StagedTrustManifest) { store.save(staged.state) }
  fun persistRuleBundle(raw: String) { val state = checkNotNull(current()); store.save(state.copy(signedRuleBundle = raw)) }
  fun registry(state: GuardDogTrustState = checkNotNull(current())): TrustedKeyRegistry = TrustedKeyRegistry(state.activeKeys().associate { it.id to it.publicKey })

  private fun parseKeys(array: JSONArray, issued: Instant, manifestExpiry: Instant): List<GuardDogOrdinaryKey> {
    check(array.length() in 1..32) { "trust manifest must contain 1..32 ordinary keys" }
    val ids = mutableSetOf<String>()
    return (0 until array.length()).map { array.getJSONObject(it) }.map { item ->
      exactKeys(item, setOf("keyId", "publicKeyB64", "validFrom", "validUntil", "status"))
      val id = item.getString("keyId"); check(id.matches(Regex("^[a-z0-9-]+$")) && ids.add(id) && id !in setOf(roots.primaryId, roots.recoveryId, TrustedKeyRegistry.M1_TEST_KEY_ID))
      val publicKey = item.getString("publicKeyB64"); check(Base64.getDecoder().decode(publicKey).size == 32 && publicKey != TrustedKeyRegistry.M1_TEST_PUBLIC_KEY_B64)
      val from = Instant.parse(item.getString("validFrom")); val until = Instant.parse(item.getString("validUntil")); val status = item.getString("status")
      check(!from.isBefore(issued) && !until.isAfter(manifestExpiry) && until.isAfter(from) && status in setOf("active", "revoked"))
      GuardDogOrdinaryKey(id, publicKey, from, until, status)
    }
  }
  private fun exactKeys(body: JSONObject, allowed: Set<String>) { check(body.keys().asSequence().toSet() == allowed) { "trust manifest schema mismatch" } }
  private fun stringSet(array: JSONArray): Set<String> = (0 until array.length()).map { array.getString(it) }.toSet()
  private fun rootsFromManifest(): GuardDogRootConfig {
    val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA); val meta = checkNotNull(info.metaData)
    return GuardDogRootConfig(meta.getString(PRIMARY_DOMAIN) ?: error("production trust domain missing"), meta.getString(PRIMARY_PROFILE) ?: error("production trust profile missing"),
      meta.getString(PRIMARY_ID) ?: error("primary root id missing"), meta.getString(PRIMARY_KEY) ?: error("primary root key missing"),
      meta.getString(RECOVERY_ID) ?: error("recovery root id missing"), meta.getString(RECOVERY_KEY) ?: error("recovery root key missing"))
  }
  companion object {
    const val ENABLED = "app.apollo.guarddog.productionEnabled"; const val PRIMARY_DOMAIN = "app.apollo.guarddog.trustDomain"; const val PRIMARY_PROFILE = "app.apollo.guarddog.trustProfile"
    const val PRIMARY_ID = "app.apollo.guarddog.primaryRootId"; const val PRIMARY_KEY = "app.apollo.guarddog.primaryRootKey"
    const val RECOVERY_ID = "app.apollo.guarddog.recoveryRootId"; const val RECOVERY_KEY = "app.apollo.guarddog.recoveryRootKey"
  }
}