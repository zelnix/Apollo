package com.hucentai.apollosecurity

import android.content.Context
import android.content.pm.PackageManager
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

internal class ProcessOwnerCell<T> {
  @Volatile private var value: T? = null
  fun getOrCreate(factory: () -> T): T = value ?: synchronized(this) { value ?: factory().also { value = it } }
  fun current(): T? = value
}

internal class TransitionCoordinator(
  private val nowNanos: () -> Long = System::nanoTime,
  private val sleeper: (Long) -> Unit = { millis -> Thread.sleep(millis) },
) {
  private val lock = ReentrantLock(true)
  fun <T> serialized(block: () -> T): T = lock.withLock(block)
  fun await(timeoutMs: Long, pollMs: Long = 50, predicate: () -> Boolean): Boolean {
    val deadline = nowNanos() + timeoutMs * 1_000_000
    do {
      if (predicate()) return true
      sleeper(pollMs)
    } while (nowNanos() < deadline)
    return predicate()
  }
}

internal object ApolloEnforcementTransitions {
  val coordinator = TransitionCoordinator()
}

internal object ApolloGuardDogEngineOwnership {
  @Volatile private var owner: String? = null
  fun claim(candidate: String) = synchronized(this) { check(owner == null || owner == candidate) { "A different GuardDog engine already owns this process" }; owner = candidate }
  fun current(): String? = owner
}

/**
 * Production GuardDog eligibility constants.
 * The custom signing key infrastructure has been removed.
 * Eligibility is now controlled solely by a manifest meta-data boolean.
 */
internal object ApolloGuardDogProductionTrust {
    /** AndroidManifest meta-data key. Set true by the withGuardDogEngine config plugin. */
    const val ENABLED = "com.hucentai.apollosecurity.GUARDDOG_PRODUCTION_ENABLED"
}

internal object ApolloGuardDogProductionOwner {
  private val cell = ProcessOwnerCell<ApolloGuardDogProductionRuntime>()
  fun isEligible(context: Context): Boolean {
    val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
    return info.metaData?.getBoolean(ApolloGuardDogProductionTrust.ENABLED, false) == true
  }
  fun get(context: Context): ApolloGuardDogProductionRuntime {
    check(isEligible(context)) { "Production GuardDog trust is disabled in this build" }
    ApolloGuardDogEngineOwnership.claim("production")
    return cell.getOrCreate { ApolloGuardDogProductionRuntime(context.applicationContext) }
  }
  fun current(): ApolloGuardDogProductionRuntime? = cell.current()
}