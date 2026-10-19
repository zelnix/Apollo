package com.guarddog.vpn

import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Runs the DNS/IP binding re-check OFF the calling thread and hands the result back through [deliver] (on the executor's thread;
 * callers hop back to their own thread as needed).
 *
 * Why: `GuardDogVpnService.onStartCommand` runs on the process main thread; `InetAddress.getAllByName` there throws
 * `NetworkOnMainThreadException`, which killed the app the first time the enforcement path ran on the proof phone
 * (verification finally ACCEPTED v25 → service started → binding check → crash). Unit tests inject fake resolvers and never hit it.
 *
 * Any resolver exception is converted into [BindingResult.ResolutionFailed] so the service fails closed instead of crashing.
 */
class OffThreadBindingCheck(private val executor: Executor = defaultExecutor) {
    fun run(config: VpnConfig, resolver: HostResolver, deliver: (BindingResult) -> Unit) {
        val caller = Thread.currentThread()
        executor.execute {
            check(Thread.currentThread() !== caller) { "binding check must not run on the caller (main) thread" }
            val result = try {
                ControlledEndpointResolver(config, resolver).verifyBinding()
            } catch (e: RuntimeException) {
                BindingResult.ResolutionFailed(config.controlledHost)
            }
            deliver(result)
        }
    }

    companion object {
        private val defaultExecutor: Executor = Executors.newSingleThreadExecutor { r -> Thread(r, "guarddog-binding-check").apply { isDaemon = true } }
    }
}
