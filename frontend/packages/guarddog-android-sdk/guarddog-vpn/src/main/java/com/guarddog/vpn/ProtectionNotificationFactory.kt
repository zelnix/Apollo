package com.guarddog.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Foreground-service notification (required for a long-running VpnService). */
object ProtectionNotificationFactory {
    const val CHANNEL_ID = "guarddog_protection"
    const val NOTIFICATION_ID = 0x6D31 // "m1"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Apollo protection", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shows while Apollo selective protection is active"
                    setShowBadge(false)
                },
            )
        }
    }

    fun build(context: Context, state: VpnLifecycleState): Notification {
        val stopIntent = PendingIntent.getService(
            context, 1,
            Intent(context, GuardDogVpnService::class.java).setAction(GuardDogVpnService.ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // Tapping the notification opens Apollo straight to the Patrol screen via its deep link.
        val contentIntent = PendingIntent.getActivity(
            context, 2,
            Intent(Intent.ACTION_VIEW, Uri.parse("apollo:///patrol")).apply {
                setPackage(context.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val text = when (state) {
            is VpnLifecycleState.Running -> "Selective protection active (${state.routeCidr})"
            VpnLifecycleState.Starting -> "Starting selective protection…"
            is VpnLifecycleState.Degraded -> "Protection degraded: ${state.reason}"
            else -> "Apollo protection"
        }
        return Notification.Builder(context, CHANNEL_ID)
            .setContentTitle("Apollo")
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "Stop", stopIntent).build())
            .build()
    }
}
