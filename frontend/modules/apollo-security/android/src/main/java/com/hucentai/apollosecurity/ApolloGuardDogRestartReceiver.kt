package com.hucentai.apollosecurity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters

/** Reconciles persisted production intent after boot, user unlock, or an in-place package update. */
class ApolloGuardDogRestartReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in ACTIONS || !ApolloGuardDogProductionOwner.isEligible(context)) return
    val work = OneTimeWorkRequestBuilder<ApolloGuardDogRestartWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
    WorkManager.getInstance(context).enqueueUniqueWork("apollo-guarddog-production-restart", ExistingWorkPolicy.REPLACE, work)
  }
  companion object { private val ACTIONS = setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_USER_UNLOCKED, Intent.ACTION_MY_PACKAGE_REPLACED) }
}

class ApolloGuardDogRestartWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result = runCatching {
    if (ApolloGuardDogProductionOwner.isEligible(applicationContext)) ApolloGuardDogProductionOwner.get(applicationContext).resumeRequested()
    Result.success()
  }.getOrElse { Result.retry() }
}