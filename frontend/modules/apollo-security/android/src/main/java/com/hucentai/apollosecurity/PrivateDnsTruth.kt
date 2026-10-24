package com.hucentai.apollosecurity

/**
 * Pure derivation of how Private DNS is set, from what Android actually tells Apollo.
 *
 * Inputs:
 *  - `setting`: Android's own Private DNS mode ("off" | "opportunistic" | "hostname") when the
 *    setting could be read, else null. Android does not promise apps this read, so null is normal.
 *  - `active` / `serverName`: the PHYSICAL network's LinkProperties (never Apollo's own tunnel).
 *
 * `not_in_use` is the honest answer when the setting is unreadable and Private DNS isn't active:
 * that is either "Off" or "Automatic on a network that doesn't support it", and Android's public
 * API can't tell those apart. It is never reported as "off".
 *
 * Only a provider hostname sends lookups past Apollo: Android then talks DNS-over-TLS straight to
 * that provider. "Automatic" still sends lookups to the DNS server the network (or Apollo's tunnel)
 * declares, so Apollo's website checks keep seeing them.
 */
internal object PrivateDnsTruth {
  const val OFF = "off"
  const val AUTOMATIC = "automatic"
  const val HOSTNAME = "hostname"
  const val NOT_IN_USE = "not_in_use"
  const val UNKNOWN = "unknown"

  fun mode(setting: String?, active: Boolean, serverName: String?, networkReadable: Boolean): String = when {
    !serverName.isNullOrBlank() -> HOSTNAME
    setting == "hostname" -> HOSTNAME
    setting == "off" -> OFF
    setting == "opportunistic" -> AUTOMATIC
    !networkReadable -> UNKNOWN
    active -> AUTOMATIC
    else -> NOT_IN_USE
  }

  fun bypassLevel(mode: String): String = when (mode) {
    HOSTNAME -> "confirmed"
    UNKNOWN -> "unobservable"
    else -> "none"
  }

  fun explanation(mode: String, server: String?): String = when (mode) {
    HOSTNAME -> "Private DNS is set to ${server ?: "a provider hostname"}, so Android sends website lookups straight to that provider and Apollo's website checks can't see them."
    OFF -> "Private DNS is Off. While Apollo's website protection runs, Apollo checks every website lookup."
    AUTOMATIC -> "Private DNS is set to Automatic. While Apollo's website protection runs, website lookups go through Apollo's checks first."
    NOT_IN_USE -> "Android reports Private DNS isn't encrypting lookups on this network. It is either Off, or Automatic on a network that doesn't support it."
    else -> "Apollo couldn't read the Private DNS setting because this phone has no network connection right now."
  }
}
