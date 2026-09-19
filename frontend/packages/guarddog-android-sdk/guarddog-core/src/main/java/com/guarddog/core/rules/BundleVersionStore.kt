package com.guarddog.core.rules

import java.util.concurrent.ConcurrentHashMap

/**
 * What the device has accepted for a rulesetId: the highest bundleVersion plus the identity of the signed envelope that
 * carried it (`envelopeHash` = SHA-256 of the JCS canonical unsigned envelope — everything the Ed25519 signature covers).
 * `envelopeHash == null` only for records written before identity was persisted (legacy rollback stores on already-installed
 * devices); the verifier pins the identity on the next authenticated acceptance of that same version.
 */
data class AcceptedBundle(val bundleVersion: Long, val envelopeHash: String?)

/**
 * Rollback protection: persists the highest accepted bundle per rulesetId.
 * Semantics enforced by RuleBundleVerifier (identical on Swift/Python):
 *  - incoming version < highest              -> ROLLBACK
 *  - incoming version > highest              -> accepted, record replaces the highest
 *  - incoming version == highest, same envelope identity (or legacy record without one) -> accepted idempotently
 *    (restart / update / re-fetch of the currently trusted bundle is not a rollback)
 *  - incoming version == highest, different authenticated envelope identity -> VERSION_CONFLICT
 * Core ships an in-memory implementation; the Expo Android module provides a SharedPreferences-backed one.
 */
interface BundleVersionStore {
    fun highestAccepted(rulesetId: String): AcceptedBundle?

    /** Never regresses: lower versions are ignored; an equal version only pins a missing identity. */
    fun recordAccepted(rulesetId: String, bundleVersion: Long, envelopeHash: String?)
}

class InMemoryBundleVersionStore : BundleVersionStore {
    private val records = ConcurrentHashMap<String, AcceptedBundle>()

    override fun highestAccepted(rulesetId: String): AcceptedBundle? = records[rulesetId]

    override fun recordAccepted(rulesetId: String, bundleVersion: Long, envelopeHash: String?) {
        records.compute(rulesetId) { _, current -> merge(current, AcceptedBundle(bundleVersion, envelopeHash)) }
    }

    companion object {
        /** Shared monotonic merge rule for every store implementation. */
        fun merge(current: AcceptedBundle?, incoming: AcceptedBundle): AcceptedBundle = when {
            current == null || incoming.bundleVersion > current.bundleVersion -> incoming
            incoming.bundleVersion == current.bundleVersion && current.envelopeHash == null -> AcceptedBundle(current.bundleVersion, incoming.envelopeHash)
            else -> current
        }
    }
}
