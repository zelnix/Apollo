package com.hucentai.apollosecurity

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest

/** Process-lifetime observer for the physical network DNS provider used by Website Gate forwarding. */
internal class ApolloGuardDogNetworkObserver(context: Context, private val changed: (String?) -> Unit) {
  private val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private val callback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) = publish()
    override fun onLost(network: Network) = publish()
    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = publish()
    override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) = publish()
  }

  fun start() {
    val request = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build()
    connectivity.registerNetworkCallback(request, callback)
    publish()
  }

  fun currentIpv4Dns(): String? = connectivity.allNetworks.asSequence().mapNotNull { network ->
    val caps = connectivity.getNetworkCapabilities(network) ?: return@mapNotNull null
    if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)) return@mapNotNull null
    val priority = when {
      caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> 0
      caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> 1
      caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> 2
      else -> 3
    }
    val dns = connectivity.getLinkProperties(network)?.dnsServers?.firstOrNull { it.address.size == 4 }?.hostAddress
    dns?.let { priority to it }
  }.sortedBy { it.first }.map { it.second }.firstOrNull()

  private fun publish() { Thread { changed(currentIpv4Dns()) }.start() }
}