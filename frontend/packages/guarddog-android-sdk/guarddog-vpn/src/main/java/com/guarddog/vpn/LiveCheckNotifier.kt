package com.guarddog.vpn

/**
 * Callback interface for live reputation check lifecycle events.
 *
 * The DNS handler notifies this listener when it begins and completes a bounded
 * live reputation check for an unknown hostname. The implementation (typically in
 * the VPN service) uses these callbacks to:
 *
 * - Show an Android notification: "Apollo is checking this website…"
 * - Update or dismiss the notification when the check completes
 * - Log observations for the daily activity feed
 *
 * Thread safety: callbacks are invoked on the DNS executor thread. Implementations
 * must handle their own thread marshalling if they need to post to the main thread
 * (e.g. for notification updates via NotificationManager).
 */
fun interface LiveCheckNotifier {
    /**
     * Called when a live reputation check lifecycle event occurs.
     *
     * @param hostname The hostname being checked
     * @param event The lifecycle event type
     */
    fun onLiveCheckEvent(hostname: String, event: LiveCheckEvent)
}

/** Live check lifecycle events. */
sealed class LiveCheckEvent {
    /** A bounded hold has started — the DNS handler is waiting for intelligence. */
    object CheckStarted : LiveCheckEvent()

    /** The check completed with a verdict. */
    data class CheckCompleted(
        val verdict: String,     // "malicious", "clean", "unknown", "unavailable"
        val confidence: String,  // "high", "medium", "low", "none"
        val blocked: Boolean,    // true if the DNS handler synthesized NXDOMAIN
    ) : LiveCheckEvent()

    /** The check timed out — DNS was forwarded without intelligence (fail open). */
    object CheckTimedOut : LiveCheckEvent()
}
