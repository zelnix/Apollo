package com.hucentai.apollosecurity

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * ApolloDnsVpnService — Site Guard for Android.
 *
 * A local, DNS-only VPN: the tunnel routes *only* the virtual DNS server address
 * (10.111.0.1/32), so ordinary traffic never enters the tunnel (battery/perf).
 * Every DNS query is parsed on-device; queries for hosts Apollo has verified
 * as threats receive NXDOMAIN, everything else is forwarded to the real upstream
 * resolver over a protected socket. No query is logged or sent anywhere else.
 */
class ApolloDnsVpnService : VpnService() {
  companion object {
    const val ACTION_START = "com.hucentai.apollosecurity.START"
    const val ACTION_STOP = "com.hucentai.apollosecurity.STOP"
    private const val TAG = "ApolloDnsVpn"
    private const val PREFS = "apollo_siteguard"
    private const val KEY_BLOCKED = "blocked_hosts"
    private const val VIRTUAL_DNS = "10.111.0.1"
    private const val TUN_ADDRESS = "10.111.0.2"
    /** apollo-security module version. Keep in sync with android/build.gradle `version` and
     * PlatformCapabilityProfile.ts CAPABILITY_PROFILE_VERSION is a SEPARATE schema-version concept — do not conflate. */
    const val MODULE_VERSION = "1.0.0"
    private const val MAX_EVIDENCE = 50

    @Volatile var isRunning = false
      private set
    @Volatile private var blocked: Set<String> = emptySet()
    @Volatile var lastBlockedAt: Long = 0L
    @Volatile var blockedCount: Long = 0L
    // Bounded, thread-safe log of real, observed enforcement actions — see EnforcementEvidence.kt.
    // Never holds anything the mock/JS side could mistake for a verified block: entries only ever
    // come from handlePacket() actually writing an NXDOMAIN reply to the tunnel.
    private val evidenceLog = ArrayDeque<EnforcementEvidence>()

    fun loadBlocked(ctx: Context): Set<String> {
      val set = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY_BLOCKED, emptySet()) ?: emptySet()
      blocked = set.map { it.lowercase() }.toSet()
      return blocked
    }
    fun addBlocked(ctx: Context, host: String) {
      val set = loadBlocked(ctx).toMutableSet(); set.add(host.lowercase())
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY_BLOCKED, set).apply(); blocked = set
    }
    fun removeBlocked(ctx: Context, host: String) {
      val set = loadBlocked(ctx).toMutableSet(); set.remove(host.lowercase())
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY_BLOCKED, set).apply(); blocked = set
    }
    /** Snapshot of the most recent real enforcement actions, newest last. Never mutated by callers. */
    fun recentEvidence(): List<EnforcementEvidence> = synchronized(evidenceLog) { evidenceLog.toList() }

    private fun recordEvidence(ev: EnforcementEvidence) = synchronized(evidenceLog) {
      evidenceLog.addLast(ev)
      while (evidenceLog.size > MAX_EVIDENCE) evidenceLog.removeFirst()
    }
  }

  private var tun: ParcelFileDescriptor? = null
  private val alive = AtomicBoolean(false)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) { stopTunnel(); stopSelf(); return START_NOT_STICKY }
    if (!alive.get()) startTunnel()
    return START_STICKY
  }

  private fun startTunnel() {
    loadBlocked(this)
    val builder = Builder()
      .setSession("Apollo Site Guard")
      .addAddress(TUN_ADDRESS, 32)
      .addDnsServer(VIRTUAL_DNS)
      .addRoute(VIRTUAL_DNS, 32) // DNS-only tunnel
      .setBlocking(true)
    try { builder.addDisallowedApplication(packageName) } catch (_: Exception) {}
    tun = builder.establish() ?: run { Log.w(TAG, "establish() returned null"); return }
    alive.set(true); isRunning = true
    thread(name = "apollo-dns-loop", isDaemon = true) { loop() }
  }

  private fun stopTunnel() {
    alive.set(false); isRunning = false
    try { tun?.close() } catch (_: Exception) {}
    tun = null
  }

  override fun onDestroy() { stopTunnel(); super.onDestroy() }
  override fun onRevoke() { stopTunnel(); super.onRevoke() }

  private fun upstreamDns(): InetAddress {
    try {
      val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val lp = cm.getLinkProperties(cm.activeNetwork)
      lp?.dnsServers?.firstOrNull { it.address.size == 4 && it.hostAddress != VIRTUAL_DNS }?.let { return it }
    } catch (_: Exception) {}
    return InetAddress.getByAddress(byteArrayOf(1, 1, 1, 1))
  }

  private fun loop() {
    val fd = tun ?: return
    val input = FileInputStream(fd.fileDescriptor)
    val output = FileOutputStream(fd.fileDescriptor)
    val buf = ByteArray(32767)
    while (alive.get()) {
      val n = try { input.read(buf) } catch (_: Exception) { -1 }
      if (n <= 0) { if (n < 0) break else continue }
      val packet = buf.copyOf(n)
      try { handlePacket(packet, output) } catch (e: Exception) { Log.d(TAG, "packet error: ${e.javaClass.simpleName}") }
    }
  }

  /** IPv4 + UDP + DNS only; anything else is dropped (the tunnel only routes the virtual DNS IP anyway). */
  private fun handlePacket(pkt: ByteArray, out: FileOutputStream) {
    // Coverage boundary: only IPv4 + UDP + port 53 is inspected (see DnsPacket.isFilterableQuery / COVERAGE).
    if (!DnsPacket.isFilterableQuery(pkt)) return
    val ihl = DnsPacket.ihl(pkt)
    val dns = DnsPacket.dnsPayload(pkt)
    val qname = DnsPacket.parseQName(dns) ?: return

    val matchedRule = DnsPacket.matchingBlockedEntry(qname, blocked)
    val response: ByteArray = if (matchedRule != null) {
      blockedCount++; lastBlockedAt = System.currentTimeMillis()
      // This IS the enforcement action: an actual NXDOMAIN reply is about to go back on the wire for a real
      // query. Evidence is recorded from this fact alone — never from the intent to block, never in advance.
      recordEvidence(EnforcementEvidence.verifiedDnsBlock(
        evidenceId = UUID.randomUUID().toString(), observedAt = Instant.ofEpochMilli(lastBlockedAt).toString(),
        domain = qname, matchedRuleId = matchedRule, osVersion = "Android ${Build.VERSION.RELEASE}", sdkVersion = MODULE_VERSION,
      ))
      DnsPacket.nxdomain(dns)
    } else {
      forward(dns) ?: return
    }
    out.write(DnsPacket.wrapReply(pkt, ihl, response))
  }

  private fun forward(query: ByteArray): ByteArray? {
    val socket = DatagramSocket()
    try {
      protect(socket)
      socket.soTimeout = 2500
      socket.send(DatagramPacket(query, query.size, InetSocketAddress(upstreamDns(), 53)))
      val reply = ByteArray(4096); val dp = DatagramPacket(reply, reply.size)
      socket.receive(dp)
      return reply.copyOf(dp.length)
    } catch (_: Exception) { return null } finally { socket.close() }
  }
}
