# Apollo Security Module — ProGuard / R8 rules
# These consumer rules are automatically picked up when the app assembles a release build.

# BouncyCastle: expo-updates uses BouncyCastle classes for code-signing verification.
# guarddog-core uses them for Ed25519. R8 must not strip these even though some are
# loaded reflectively (e.g. the JCE security provider).
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# GuardDog: kotlinx-serialization uses reflection and @Serializable generates classes
# that R8 cannot trace statically.
-keepclassmembers class com.guarddog.** {
    <fields>;
    <methods>;
}
-keep class com.guarddog.core.rules.** { *; }
-keep class com.guarddog.core.events.** { *; }
-keep class com.guarddog.core.protection.** { *; }
-keep class com.guarddog.vpn.** { *; }

# Apollo security module itself
-keep class com.hucentai.apollosecurity.** { *; }
