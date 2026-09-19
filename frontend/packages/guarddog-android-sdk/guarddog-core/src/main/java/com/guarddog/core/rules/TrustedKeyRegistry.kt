package com.guarddog.core.rules

import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

/**
 * Trusted Ed25519 public keys by keyId. Supports rollover: keys can be introduced
 * and retired at runtime without bridge/API changes. Only PUBLIC keys live here.
 */
class TrustedKeyRegistry(initial: Map<String, String> = emptyMap()) {
    private val keys = ConcurrentHashMap<String, ByteArray>()

    init { initial.forEach { (id, b64) -> trust(id, b64) } }

    fun trust(keyId: String, publicKeyB64: String) {
        val raw = Base64.getDecoder().decode(publicKeyB64)
        require(raw.size == 32) { "Ed25519 public key must be 32 bytes" }
        keys[keyId] = raw
    }

    fun retire(keyId: String) { keys.remove(keyId) }

    fun publicKeyFor(keyId: String): ByteArray? = keys[keyId]

    fun trustedKeyIds(): Set<String> = keys.keys.toSet()

    companion object {
        /** M1 test-only public key (pinned). Private key is backend-only and never ships. */
        const val M1_TEST_KEY_ID = "gd-m1-test-ed25519-001"
        const val M1_TEST_PUBLIC_KEY_B64 = "ccf41NL6VHYQsH171Lw98hKiIoQFvAY0t171X4PL/ac="

        fun m1Default(): TrustedKeyRegistry = TrustedKeyRegistry(mapOf(M1_TEST_KEY_ID to M1_TEST_PUBLIC_KEY_B64))
    }
}
