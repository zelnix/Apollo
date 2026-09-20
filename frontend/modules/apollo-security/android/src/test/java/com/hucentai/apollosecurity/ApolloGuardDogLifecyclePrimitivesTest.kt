package com.hucentai.apollosecurity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class ApolloGuardDogLifecyclePrimitivesTest {
  @Test fun moduleRecreationUsesOneProcessOwner() {
    val cell = ProcessOwnerCell<Any>(); val created = AtomicInteger()
    val first = cell.getOrCreate { created.incrementAndGet(); Any() }
    val recreatedModuleView = cell.getOrCreate { created.incrementAndGet(); Any() }
    assertSame(first, recreatedModuleView); assertEquals(1, created.get())
  }

  @Test fun competingTransitionsAreSerialized() {
    val coordinator = TransitionCoordinator(); val active = AtomicInteger(); val max = AtomicInteger(); val done = CountDownLatch(2)
    val pool = Executors.newFixedThreadPool(2)
    repeat(2) {
      pool.submit { coordinator.serialized { val now = active.incrementAndGet(); max.updateAndGet { old -> maxOf(old, now) }
        Thread.sleep(60); active.decrementAndGet() }; done.countDown() }
    }
    assertTrue(done.await(2, TimeUnit.SECONDS)); pool.shutdownNow(); assertEquals(1, max.get())
  }

  @Test fun delayedTransitionIsObservedAndTimeoutFails() {
    val ready = AtomicBoolean(false); Thread { Thread.sleep(80); ready.set(true) }.start()
    assertTrue(TransitionCoordinator().await(500, 10) { ready.get() })
    assertFalse(TransitionCoordinator().await(40, 10) { false })
  }
}