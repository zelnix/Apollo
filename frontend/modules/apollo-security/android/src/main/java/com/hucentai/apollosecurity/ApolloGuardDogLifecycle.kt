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

internal object ApolloGuardDogProcessOwner {
  private val cell = ProcessOwnerCell<ApolloGuardDogCandidateRuntime>()

  fun isEligible(context: Context): Boolean {
    val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
    return info.metaData?.getBoolean(ApolloGuardDogCandidateRuntime.ACCEPTANCE_METADATA_KEY, false) == true
  }

  fun get(context: Context): ApolloGuardDogCandidateRuntime {
    check(isEligible(context)) { "GuardDog acceptance trust is disabled in this build" }
    return cell.getOrCreate { ApolloGuardDogCandidateRuntime(context.applicationContext) }
  }

  fun current(): ApolloGuardDogCandidateRuntime? = cell.current()
}