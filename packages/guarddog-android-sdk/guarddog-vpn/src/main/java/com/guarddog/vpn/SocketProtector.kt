package com.guarddog.vpn

import java.net.DatagramSocket

/**
 * Abstracts `android.net.VpnService.protect()` so the pure-Kotlin forwarder never imports Android
 * types directly. The real implementation (wired by [GuardDogVpnService]) protects the upstream
 * DNS socket so ITS traffic bypasses the tunnel -- otherwise the forwarder's own outbound packet
 * would re-enter the TUN and loop forever.
 */
fun interface SocketProtector {
    fun protect(socket: DatagramSocket): Boolean
}
