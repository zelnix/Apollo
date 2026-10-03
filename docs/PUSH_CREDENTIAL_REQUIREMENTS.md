# Push Notification Credential Requirements

**Date:** 2026-10-03
**Status:** Frontend push registration RESTORED — awaiting credential provisioning.

---

## What You Need to Supply

### 1. Expo Push Access Token (REQUIRED — unlocks all push delivery)

| Detail | Value |
|---|---|
| **Where to get it** | [expo.dev](https://expo.dev) → Account Settings → Access Tokens → **Create Token** |
| **Token type** | Robot or Personal (robot recommended for production) |
| **Scope** | The token must belong to the Expo account that owns project `threat-patrol-1` |
| **Where to enter it** | `backend/.env` → uncomment and set `EXPO_PUSH_ACCESS_TOKEN=<your-token>` |
| **Also set** | `backend/.env` → uncomment `EXPO_PUSH_ENABLED=true` |
| **Then** | Restart backend: `sudo supervisorctl restart backend` |

**Enhanced Push Security:** The backend already sends this token as `Authorization: Bearer <token>` on every push API call (line 157 of `push.py`). This IS Expo's enhanced push security — it prevents anyone without your token from sending pushes to your app's users. It is **active** the moment you set the token.

```env
# backend/.env — uncomment both lines and set the token:
EXPO_PUSH_ENABLED=true
EXPO_PUSH_ACCESS_TOKEN=ExponentPushToken_your_actual_token_here
```

### 2. Firebase google-services.json (REQUIRED for Android push)

| Detail | Value |
|---|---|
| **Why** | Expo Push on Android routes through Firebase Cloud Messaging (FCM) under the hood. Without `google-services.json`, `getExpoPushTokenAsync()` fails on Android devices. |
| **Where to get it** | [Firebase Console](https://console.firebase.google.com) → your project → Project Settings → General → Android app → **Download google-services.json** |
| **Firebase project requirement** | The Firebase project must have an Android app registered with package name `app.apollo.hwg` |
| **Where to place it** | `/app/frontend/google-services.json` |
| **Also add to app.json** | Under `"expo" → "android"`, add: `"googleServicesFile": "./google-services.json"` |
| **Was it removed?** | Yes — it was removed during the Firebase cleanup session. That session removed Firebase as a direct dependency, but Expo Push still uses FCM internally for Android delivery. |

**After placing the file**, add the reference to `app.json`:
```json
{
  "expo": {
    "android": {
      "googleServicesFile": "./google-services.json",
      ...
    }
  }
}
```

### 3. FCM Server Key / Cloud Messaging API (REQUIRED for Android push)

| Detail | Value |
|---|---|
| **Why** | Expo's push service needs authorization to send via FCM to your app. |
| **Where to configure** | [expo.dev](https://expo.dev) → your project → Credentials → Android → **FCM Server Key** or **FCM V1 Service Account Key** |
| **Option A: Legacy FCM key** | Firebase Console → Project Settings → Cloud Messaging → **Server key** (if available) → paste into Expo dashboard |
| **Option B: FCM V1 (recommended)** | Firebase Console → Project Settings → Service accounts → **Generate new private key** → upload the JSON to Expo dashboard |
| **Where to enter it** | Expo dashboard only — never in your codebase |

### 4. Apple Push Notification service (REQUIRED for iOS push — not needed for Android-only testing)

| Detail | Value |
|---|---|
| **Why** | Expo Push on iOS routes through APNs. |
| **Where to configure** | [expo.dev](https://expo.dev) → your project → Credentials → iOS → **Push Key** |
| **Where to get it** | [Apple Developer Portal](https://developer.apple.com) → Certificates, Identifiers & Profiles → Keys → Create a key with "Apple Push Notifications service (APNs)" → download the .p8 file |
| **Where to enter it** | Expo dashboard only — upload the .p8 key + provide Key ID and Team ID |

---

## What Is Already Done (No Action Needed)

| Item | Status |
|---|---|
| `EXPO_PROJECT_ID` in backend `.env` | ✅ Set to `47cd97c4-e5a6-41fa-9fde-257a5de031af` |
| Frontend push token registration code | ✅ Restored in `src/push/notifications.ts` → `registerRemotePush()` |
| Egress policy for push registration | ✅ Added `push_register` endpoint to `src/domain/privacy.ts` |
| ApolloContext integration | ✅ Calls `registerRemotePush()` on device identity establish and on setup completion |
| Backend push routes (`/register-push`, `/push/registration`, `/push/deliveries/{id}`, `/push/test`) | ✅ Already implemented and tested (14 tests) |
| Backend `send_push()` delivery pipeline | ✅ Already wired to family alerts, weekly check-ins, incidents, voice notes, owner alerts |
| Push receipt reconciliation (background loop) | ✅ Runs every 5 minutes |
| Notification channels (Android) | ✅ threats, family, growling, default |
| Enhanced Push Security (Bearer token auth) | ✅ Backend sends token on every API call |

---

## Activation Sequence

1. **Get credentials**: Expo Access Token + Firebase google-services.json + FCM key
2. **Place google-services.json** at `/app/frontend/google-services.json`
3. **Add `googleServicesFile`** reference to `app.json`
4. **Set backend env vars**: `EXPO_PUSH_ENABLED=true` and `EXPO_PUSH_ACCESS_TOKEN=<token>`
5. **Restart backend**: `sudo supervisorctl restart backend`
6. **Redeploy + build**: Publish → generate new APK/IPA
7. **Test on device**: Install → grant notification permission → Settings → "Test notification" → confirm delivery

---

## Verification Checklist

| Step | How to verify |
|---|---|
| Backend push configured | `GET /api/push/registration` → `{"configured": true, ...}` |
| Frontend token registered | `GET /api/push/registration` → `{"registered": true, "platform": "android", ...}` |
| Test push delivered | `POST /api/push/test` → 201 → notification appears on device |
| Family alert delivered | Trigger a barking event → paired guardian receives push |
| Weekly check-in | Wait for Sunday 17:00 local → guardian receives "How's [name] doing?" |
| Receipt reconciliation | Check backend logs for "Push receipts reconciled" every 5 minutes |
