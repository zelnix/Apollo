package com.hucentai.apollosecurity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Phase A — Apps & Device: catalog + mapping logic, and the manifest visibility contract. */
class AppDeviceCatalogTest {
  @Test fun `install source maps stores browsers and messengers, unknown stays not_sure`() {
    assertEquals("play_store", AppDeviceCatalog.installSource("com.android.vending"))
    assertEquals("other_store", AppDeviceCatalog.installSource("com.sec.android.app.samsungapps"))
    assertEquals("browser", AppDeviceCatalog.installSource("com.android.chrome"))
    assertEquals("browser", AppDeviceCatalog.installSource("com.google.android.packageinstaller"))
    assertEquals("message", AppDeviceCatalog.installSource("com.whatsapp"))
    assertEquals("not_sure", AppDeviceCatalog.installSource(null))
    assertEquals("not_sure", AppDeviceCatalog.installSource("com.example.unknown"))
  }

  @Test fun `catalog resolves by package or display name and never invents apps`() {
    assertEquals("com.anydesk.anydeskandroid", AppDeviceCatalog.resolveCatalogPackage("AnyDesk"))
    assertEquals("com.anydesk.anydeskandroid", AppDeviceCatalog.resolveCatalogPackage("anydesk "))
    assertEquals("com.teamviewer.quicksupport.market", AppDeviceCatalog.resolveCatalogPackage("teamviewer quicksupport"))
    assertEquals("com.rustdesk.rustdesk", AppDeviceCatalog.resolveCatalogPackage("com.rustdesk.rustdesk"))
    assertNull(AppDeviceCatalog.resolveCatalogPackage("CommBank"))
    assertNull(AppDeviceCatalog.resolveCatalogPackage(""))
    assertTrue(AppDeviceCatalog.isRemoteAccessTool("COM.ANYDESK.ANYDESKANDROID"))
    assertFalse(AppDeviceCatalog.isRemoteAccessTool("com.commbank.netbank"))
  }

  @Test fun `accessibility setting parsing keeps third-party packages only`() {
    val setting = "com.google.android.marvin.talkback/.TalkBackService:com.evil.helper/.Svc:app.hwg.apollo/.X:com.evil.helper/.Other:com.samsung.accessibility/.U"
    assertEquals(listOf("com.evil.helper"), AppDeviceCatalog.thirdPartyServices(setting, "app.hwg.apollo"))
    assertTrue(AppDeviceCatalog.thirdPartyServices(null, "app.hwg.apollo").isEmpty())
    assertTrue(AppDeviceCatalog.thirdPartyServices("", "app.hwg.apollo").isEmpty())
  }

  @Test fun `permissions are translated to plain words and unknown ones are dropped`() {
    val plain = AppDeviceCatalog.plainPermissions(arrayOf("android.permission.READ_SMS", "android.permission.INTERNET", "android.permission.CAMERA", "android.permission.READ_SMS"))
    assertEquals(listOf("Read SMS", "Camera"), plain)
    assertTrue(AppDeviceCatalog.plainPermissions(null).isEmpty())
  }

  @Test fun `manifest queries match the catalog exactly and never request QUERY_ALL_PACKAGES`() {
    val manifest = File("src/main/AndroidManifest.xml").takeIf { it.exists() } ?: File("android/src/main/AndroidManifest.xml")
    val text = manifest.readText()
    assertFalse("Apollo must never request QUERY_ALL_PACKAGES", text.contains("QUERY_ALL_PACKAGES"))
    assertFalse("Apollo must never be an AccessibilityService", text.contains("accessibilityservice"))
    val declared = Regex("<package android:name=\"([^\"]+)\"").findAll(text).map { it.groupValues[1] }.toSet()
    assertEquals(AppDeviceCatalog.VISIBLE_PACKAGES.toSet(), declared)
  }
}
