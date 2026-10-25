# Family Help two-phone test

A step-by-step check of Family Help on two real phones, before it goes to customers. It needs the installed ApolloSG app on both phones (an Android APK or an iPhone build from **Publish**). Family Help does not work in Expo Go or the web preview.

**Phone A** is the person asking for help: they share their screen. **Phone B** is the helper: they only watch.

Tick each step, and write down anything that doesn't match **Expect**. The results sheet at the end is what to send back.

---

## 1. Before you start

- [ ] The banner at the top of this page says **Server ready**. If it doesn't, Family Help shows "Not available yet" on both phones.
- [ ] Both phones have the newest build installed, and both use the same ApolloSG server (both preview, or both live).
- [ ] Both phones have finished setup in ApolloSG.
- [ ] Phone B is linked to Phone A as family: on Phone A, **Family** shows Phone B's name as someone who watches over this phone.
- [ ] Write down each phone's make, model and system version on the results sheet.
- [ ] Both phones are charged, and on Wi-Fi to start with.

---

## 2. Ask for help and accept

1. **Phone A:** Family → **Family Help** → **Ask family for help**.
   - Expect: the list shows Phone B's name.
2. **Phone A:** tap Phone B's name, keep **My full screen**, then tap **Send help request**.
   - Expect: "Invitation sent" and "Waiting for …".
3. **Phone B:** open the help request (from the alert, or Family).
   - Expect: "… is asking for help", with **I can help** and **Not now**.
4. **Phone B:** tap **I can help**.
   - Expect on Phone A: "… accepted" and **Choose what to share**.

---

## 3. Start sharing

1. **Phone A:** tap **Choose what to share**.
   - **Android:** the system screen-capture prompt opens. Choose the full screen and tap **Start now**.
   - **iPhone or iPad:** the broadcast sheet opens with **ApolloSG Family Help**. Tap **Start Broadcast**.
2. Expect on **Phone A**, within about 10 seconds:
   - the status reads **Sharing is on**;
   - Android shows the notification "Your screen is being shared with …", with **Pause** and **Stop sharing**;
   - iPhone shows the red recording indicator at the top of the screen.
3. Expect on **Phone B:** Phone A's screen appears, with **View only**.
4. Expect on **both phones:** a connection line, **Direct connection** or **Relayed connection**. Write down which.

---

## 4. Keep it running (the old 2-minute drop)

1. Leave the session running for **at least 10 minutes**. Move around a few screens on Phone A now and then.
   - Expect: the picture keeps coming on Phone B, and nothing ends at the 2-minute mark.
2. **Phone A:** press Home and open another app (Settings, Photos).
   - Expect: Phone B still sees Phone A's screen. On iPhone, the broadcast carries on in the background.
3. **Phone A:** go back into ApolloSG.
   - Expect: still **Sharing is on**.

---

## 5. Connection status: direct, relayed and reconnecting

1. **Reconnecting:** on **Phone B**, turn Wi-Fi off for about 10 seconds (keep mobile data on), then turn it back on.
   - Expect on both phones: **Reconnecting**, then back to **Direct connection** or **Relayed connection**, and the picture returns.
   - If the session ends instead, write down how long Wi-Fi was off.
2. **Relayed:** put the two phones on different networks: Phone A on mobile data, Phone B on a guest, work or hotel Wi-Fi.
   - Expect: **Relayed connection** on some networks, **Direct connection** on others. Both are fine; write down which you saw on which networks.
3. A relayed picture may be a little slower or softer than a direct one. Write down anything that looks worse than that.

---

## 6. Pause, continue and add time

1. **Phone A:** tap **Pause sharing**.
   - Expect on Phone B: "They paused sharing. No screen image is shown."
   - Expect on Phone A: **Paused**.
2. **Phone A:** tap **Continue sharing**.
   - Expect: the picture comes back on Phone B.
3. **Android only:** use **Pause** and then **Continue sharing** from the notification.
   - Expect: the same as steps 1 and 2.
4. **Phone A:** tap **Add 30 minutes**.
   - Expect: no error, and sharing carries on.
5. **Phone B:** try to tap and type on Phone A's picture.
   - Expect: nothing happens on Phone A. No sound is heard on Phone B.

---

## 7. Ending a session

Run each ending as its own short session (steps 2 and 3 again to start).

1. **Stop from the app:** Phone A taps **Stop sharing**.
   - Expect: Phone B's session ends within a few seconds. Phone A's notification or red indicator goes.
2. **Helper leaves:** Phone B taps **Leave session**.
   - Expect: Phone A stops sharing on its own, and the notification or red indicator goes.
3. **Stop from the system:**
   - **Android:** tap **Stop sharing** in the notification.
   - **iPhone:** tap the red indicator, then **Stop**.
   - Expect: both phones end the session.
4. **Helper says no:** Phone B taps **Not now** on a new request.
   - Expect: Phone A goes back to Family, and nothing is shared.
5. **No approval:** Phone A taps **Choose what to share**, then cancels the system prompt.
   - Expect: after about 60 seconds, "Screen sharing approval timed out. No screen image is being shared."

---

## 8. Restart checks

1. Close ApolloSG fully on both phones (swipe it away), then open it again.
   - Expect: both open normally, with no crash.
2. Start one more session (steps 2 and 3).
   - Expect: it works the same as the first time.
3. Turn one phone off and on again, then open ApolloSG.
   - Expect: it opens normally, and no old session is still sharing.

---

## 9. Results sheet

| Step | Phone A | Phone B | Pass or fail | Notes |
|---|---|---|---|---|
| 1. Before you start | | | | |
| 2. Ask for help and accept | | | | |
| 3. Start sharing | | | | |
| 4. Keep it running | | | | |
| 5. Connection status | | | | |
| 6. Pause, continue and add time | | | | |
| 7. Ending a session | | | | |
| 8. Restart checks | | | | |

**Send back:**
- each phone's make, model and system version;
- which connection type you saw, and on which networks;
- for anything that failed: the step, the time it happened, and a screenshot from each phone;
- the **Recent Family Help sessions** table below, which shows how each session ended.
