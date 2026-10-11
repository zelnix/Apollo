package com.guarddog.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Foreground-service notification (required for a long-running VpnService) and live-check
 * transient notifications. */
object ProtectionNotificationFactory {
    const val CHANNEL_ID = "guarddog_protection"
    const val NOTIFICATION_ID = 0x6D31 // "m1"

    /** Separate channel for live reputation check notifications (transient, informational). */
    const val LIVE_CHECK_CHANNEL_ID = "guarddog_live_check"
    const val LIVE_CHECK_NOTIFICATION_ID = 0x6C63 // "lc"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Apollo", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shows while Apollo's protection service is running"
                    setShowBadge(false)
                },
            )
        }
        // Live check channel: low importance, no sound, no vibration — purely informational.
        if (manager.getNotificationChannel(LIVE_CHECK_CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(LIVE_CHECK_CHANNEL_ID, "Apollo Live Checks", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shows briefly when Apollo is checking an unknown website"
                    setShowBadge(false)
                    enableLights(false)
                    enableVibration(false)
                },
            )
        }
    }

    fun build(context: Context, state: VpnLifecycleState): Notification {
        // Tapping the notification opens Apollo straight to the Home screen via its deep link.
        val contentIntent = PendingIntent.getActivity(
            context, 2,
            Intent(Intent.ACTION_VIEW, Uri.parse("apollo:///")).apply {
                setPackage(context.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val text = when (state) {
            is VpnLifecycleState.Running -> "Apollo protection service is running."
            VpnLifecycleState.Starting -> "Apollo protection service is starting…"
            is VpnLifecycleState.Degraded -> "Apollo protection service is paused."
            else -> "Apollo"
        }
        return Notification.Builder(context, CHANNEL_ID)
            .setContentTitle("Apollo")
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    // ── Stage 3: Live reputation check notifications ─────────────────────────

    /** Build a transient "Apollo is checking this website…" notification. */
    fun buildLiveCheckStarted(context: Context, hostname: String): Notification {
        val displayHost = truncateHost(hostname)
        return Notification.Builder(context, LIVE_CHECK_CHANNEL_ID)
            .setContentTitle("Apollo is checking a website\u2026")
            .setContentText(displayHost)
            .setSmallIcon(android.R.drawable.ic_menu_search)
            .setOngoing(false)
            .setAutoCancel(true)
            .setTimeoutAfter(5000) // Auto-dismiss after 5 seconds max
            .build()
    }

    /** Build a transient notification for a completed live check that prevented DNS access
     *  to a malicious site. This is DNS-level PREVENTION (sinkhole response issued), NOT a
     *  verified connection block — Apollo has no native evidence of a dropped TCP/TLS packet. */
    fun buildLiveCheckBlocked(context: Context, hostname: String): Notification {
        val contentIntent = PendingIntent.getActivity(
            context, 3,
            Intent(Intent.ACTION_VIEW, Uri.parse("apollo:///")).apply {
                setPackage(context.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val displayHost = truncateHost(hostname)
        return Notification.Builder(context, LIVE_CHECK_CHANNEL_ID)
            .setContentTitle("Apollo detected a dangerous website")
            .setContentText("DNS access to $displayHost has been prevented.")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(contentIntent)
            .setOngoing(false)
            .setAutoCancel(true)
            .setTimeoutAfter(15000) // Visible for 15 seconds then auto-dismiss
            .build()
    }

    /** Build a transient notification for a completed live check — site is clean. */
    fun buildLiveCheckClean(context: Context, hostname: String): Notification {
        val displayHost = truncateHost(hostname)
        return Notification.Builder(context, LIVE_CHECK_CHANNEL_ID)
            .setContentTitle("Website checked — looks safe")
            .setContentText(displayHost)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(false)
            .setAutoCancel(true)
            .setTimeoutAfter(3000) // Brief confirmation — 3 seconds
            .build()
    }

    /** Truncate hostname for display in notification text (avoid overly long domains). */
    private fun truncateHost(hostname: String): String =
        if (hostname.length > 50) hostname.take(47) + "\u2026" else hostname
}
