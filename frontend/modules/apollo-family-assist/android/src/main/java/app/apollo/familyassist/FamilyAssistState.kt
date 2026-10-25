package app.apollo.familyassist

import java.time.Instant

/**
 * Everything JS can read about Family Help on this device, as one immutable snapshot.
 *
 * Why a snapshot and not a map: the first build kept this state in a ConcurrentHashMap and seeded it with
 * null values. ConcurrentHashMap rejects nulls, so the object initialiser threw on the first access — which
 * the module's OnCreate makes at app startup — and the app crashed before it opened. A data class has no
 * such limit, and [toMap] builds a plain HashMap (which accepts nulls) only when the bridge needs one.
 * Kept free of Android and WebRTC types so it is unit-tested on the JVM (src/test).
 */
data class FamilyAssistState(
  val sessionId: String? = null,
  val generation: String? = null,
  val captureState: String = IDLE,
  val helperConnected: Boolean = false,
  val captureScope: String? = null,
  val microphoneEnabled: Boolean = false,
  val startedAt: String? = null,
  val lastTransitionAt: String,
  val failureCode: String? = null,
  val endReason: String? = null,
) {
  fun owns(sessionId: String?, generation: String?): Boolean =
    sessionId != null && generation != null && this.sessionId == sessionId && this.generation == generation

  fun toMap(): HashMap<String, Any?> = hashMapOf(
    "sessionId" to sessionId, "generation" to generation, "captureState" to captureState,
    "helperConnected" to helperConnected, "captureScope" to captureScope, "microphoneEnabled" to microphoneEnabled,
    "startedAt" to startedAt, "lastTransitionAt" to lastTransitionAt, "failureCode" to failureCode, "endReason" to endReason,
  )

  companion object {
    const val IDLE = "idle"
    /** States from which a new capture or viewer may take over. */
    val IDLE_STATES = setOf(IDLE, "stopped", "failed")
    val TERMINAL_STATES = setOf("stopped", "failed")
  }
}

/**
 * The single owner of [FamilyAssistState]. Every change is serialised, and a change that names a session or
 * generation other than the current one is dropped, so a late callback from an ended session can never
 * overwrite the state of the session that replaced it (stale-session fencing).
 */
class FamilyAssistStateStore(private val clock: () -> String = { Instant.now().toString() }) {
  private val lock = Any()
  @Volatile private var current = FamilyAssistState(lastTransitionAt = clock())

  fun snapshot(): FamilyAssistState = current

  fun canTakeOver(): Boolean = current.captureState in FamilyAssistState.IDLE_STATES

  /** Makes [sessionId]/[generation] the current session, replacing whatever ended before it. */
  fun begin(sessionId: String, generation: String, captureState: String, captureScope: String? = null): FamilyAssistState = synchronized(lock) {
    current = FamilyAssistState(
      sessionId = sessionId, generation = generation, captureState = captureState,
      captureScope = captureScope, lastTransitionAt = clock(),
    )
    current
  }

  /**
   * Moves the current session to [captureState]. Returns false, changing nothing, when the caller's session is
   * not the current one or the session has already ended (a terminal state only gives way to a new [begin]).
   */
  fun transition(
    sessionId: String?, generation: String?, captureState: String,
    failure: String? = null, reason: String? = null, helperConnected: Boolean? = null, markStarted: Boolean = false,
  ): Boolean = synchronized(lock) {
    val now = current
    if (!now.owns(sessionId, generation)) return false
    if (now.captureState in FamilyAssistState.TERMINAL_STATES) return false
    val ended = captureState in FamilyAssistState.TERMINAL_STATES
    current = now.copy(
      captureState = captureState, lastTransitionAt = clock(), failureCode = failure, endReason = reason,
      helperConnected = if (ended) false else helperConnected ?: now.helperConnected,
      startedAt = if (markStarted) clock() else now.startedAt,
    )
    true
  }
}
