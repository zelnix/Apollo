# ApolloSG: Google Play Console declarations checklist

What Google Play will ask about ApolloSG's Android build, in the order Play Console shows it under
**Policy and programs → App content**. Fill these in once, when you first send a build to Play for review.
Each item names the feature, why ApolloSG needs it, and what the demo video must show.

## What is NOT in the build (nothing to declare)

| Permission | Status |
| --- | --- |
| Read texts (`READ_SMS`) and call history (`READ_CALL_LOG`) | Stripped from every build (`plugins/withRestrictedPhonePermissions.js`). Do **not** fill in the SMS and Call Log declaration. See `docs/APOLLO_PLAY_RESTRICTED_PERMISSIONS_FUTURE_DECLARATIONS.md`. |
| Microphone (`RECORD_AUDIO`) | Stripped (`expo-camera` / `expo-audio` set to no microphone). |
| Precise location (`ACCESS_FINE_LOCATION`) | Removed 2026-10. ApolloSG never asked for it. Without it, Android hides the Wi-Fi network name, and Apollo already handles that. |
| Display over other apps (`SYSTEM_ALERT_WINDOW`) | Stripped (`android.blockedPermissions`). Apollo only *checks* whether other apps hold it. |
| Background music player (`FOREGROUND_SERVICE_MEDIA_PLAYBACK`) | Removed (`expo-audio` `enableBackgroundPlayback: false`). Alert sounds play only while ApolloSG is open. |
| All installed apps (`QUERY_ALL_PACKAGES`) | Not used. ApolloSG lists only launchable apps through a narrow `<queries>` block. |
| Accessibility service, install other apps | Not used. |

## 1. VPN service: website protection

- **Where:** App content → *VPN service* (also mention it in the store description).
- **Category to pick:** *Device security*.
- **Say:** "ApolloSG's website protection runs a local, on-device VPN that only answers website name (DNS) lookups. It blocks known scam and phishing websites before the page loads. Traffic is not routed to a remote server, and Apollo does not read page contents. The user turns it on in ApolloSG and can turn it off in ApolloSG or Android Settings."
- **Video:** open ApolloSG → Protection → turn on website protection → accept Android's VPN prompt → open a known test phishing page in Chrome → show it blocked and Apollo's alert.

## 2. Foreground services (Android 14+): one entry per type

Play Console → App content → *Foreground service permissions*. For each type: describe the feature, what
happens if Android delays or stops it, and give a video link.

| Service | Type | Feature and impact | Video must show |
| --- | --- | --- | --- |
| `GuardDogVpnService` | `systemExempted` (a VPN configured in Android's VPN settings) | Website protection keeps blocking scam sites while ApolloSG is in the background. If stopped, scam sites aren't blocked until the user reopens ApolloSG. | Turning website protection on in ApolloSG, the VPN key icon, and a blocked site while ApolloSG is in the background. |
| `FamilyAssistProjectionService` | `mediaProjection` | Family Assist: the person chooses to share their screen with a linked family helper so they can be guided through a suspicious situation. If stopped, the share ends and the helper sees nothing. | The person tapping *Share my screen* in Family Assist, Android's screen-capture consent dialog, and the helper seeing the screen. |

## 3. Notification access: Text Gate

Notification access isn't a Play declaration form, but Play's User Data policy requires the following:

- **In the app, before Android's settings open:** Text Gate's setup screen (`app/text-guard.tsx`) explains
  that Apollo reads incoming text *notifications* from the default messaging app to check them for scams,
  that it's optional, and how to turn it off. Keep that screen before the *Turn on notification access* button.
- **Data safety form:** declare *Messages → Other in-app messages / SMS*: collected, processed for app
  functionality (fraud prevention), not shared, optional, and deletable. Message text that ApolloSG sends for a
  check is deleted 24 hours after the check completes (Rule Book).

## 4. Data safety form: the rest

Declare: device or other IDs (ApolloSG's device credential), app activity (checks you run), photos and files
*you choose to submit* (deleted 24 hours after the check), and a phone number only if a family member saves
one to call the person back. Mark everything **encrypted in transit**, **not sold**, and **deletable on request**.
Sharing: only to the processors listed in `docs/compliance/HWG_THIRD_PARTY_SERVICE_REGISTER.md`.

## 5. Before every Play upload

1. `cd frontend && npx expo config --type introspect --json`. In `_internal.modResults.android.manifest`,
   confirm that `READ_SMS`, `READ_CALL_LOG`, `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` show `tools:node="remove"`, and
   that `ACCESS_FINE_LOCATION` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK` are absent.
2. `node --test tests/playPermissions.test.ts` passes.
3. If a new permission or foreground service appears, add it to this checklist before uploading.
