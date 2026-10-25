// Family Help on iPhone and iPad (step 10): source checks for the ReplayKit sharer, the helper's viewer and the app module.
// There is no Apple toolchain here, so these read the Swift sources; the first compile happens in the next iOS build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const IOS = "modules/apollo-family-assist/ios/";
// Code only: comments may name the things the code must not do.
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const app = Object.fromEntries(["ApolloFamilyAssistModule.swift", "FamilyAssistState.swift", "FamilyAssistWebRtc.swift", "FamilyAssistViewerPeer.swift", "FamilyAssistViewerView.swift"].map((f) => [f, code(read(IOS + f))]));
const allApp = Object.values(app).join("\n");
const broadcast = code(read(IOS + "Broadcast/SampleHandler.swift"));

test("the constructs that could not compile are gone", () => {
  for (const source of [allApp, broadcast]) {
    assert.doesNotMatch(source, /extension AnyObject/, "AnyObject cannot be extended");
    assert.doesNotMatch(source, /\.also \{/);
    assert.doesNotMatch(source, /command\(for: handoff\)/, "optional passed where a value is required");
    assert.doesNotMatch(source, /\bawait\b/, "Expo AsyncFunction closures here are synchronous");
  }
  // The extension writes its state to UserDefaults, which cannot hold NSNull (it would throw and end the extension).
  assert.doesNotMatch(broadcast, /NSNull/);
  assert.match(code(read(IOS + "ApolloFamilyAssist.podspec")), /s\.swift_version = '5\.9'/);
});

test("server times with fractional seconds and +00:00 parse in the app and the extension", () => {
  for (const source of [app["FamilyAssistState.swift"], broadcast]) assert.match(source, /replacingOccurrences\(of: #"\\\.\\d\+"#, with: "", options: \.regularExpression\)/);
  assert.doesNotMatch(app["ApolloFamilyAssistModule.swift"] + app["FamilyAssistViewerPeer.swift"], /ISO8601DateFormatter\(\)\.date\(/, "parse through FamilyAssistDates only");
  assert.match(app["ApolloFamilyAssistModule.swift"], /FamilyAssistDates\.parse\(expiry\)/);
  assert.match(app["FamilyAssistViewerPeer.swift"], /FamilyAssistDates\.parse\(raw\)/);
  // What the dropped fraction looks like on the wire (Python isoformat), and that removing it leaves an ISO 8601 time.
  const sample = "2026-06-01T10:00:00.123456+00:00".replace(/\.\d+/, "");
  assert.equal(sample, "2026-06-01T10:00:00+00:00");
});

test("state is fenced by session and generation, and an ended session stays ended", () => {
  const store = app["FamilyAssistState.swift"];
  assert.match(store, /if !now\.owns\(sessionId, generation\) \{ return false \}/);
  assert.match(store, /if FamilyAssistState\.terminalStates\.contains\(now\.captureState\) \{ return false \}/);
  assert.doesNotMatch(allApp, /state\["/, "no loose state dictionary");
  for (const call of allApp.match(/FamilyAssistRuntime\.shared\.update\([^)]*/g) ?? []) {
    assert.match(call, /^FamilyAssistRuntime\.shared\.update\((handoff\.)?sessionId, (handoff\.)?generation, /, call);
  }
  const runtime = app["ApolloFamilyAssistModule.swift"];
  assert.match(runtime, /guard viewer === peer else \{ lock\.unlock\(\); return \}/, "only the current viewer can end the session");
  assert.match(runtime, /let fresh = revision > lastExtensionRevision/, "each extension update is taken in once");
  assert.match(app["FamilyAssistViewerPeer.swift"], /messageGeneration != generation \{ return \}/);
  assert.match(broadcast, /generation != handoff\?\.generation \{ return \}/);
});

test("WebRTC is set up in one place per process and audio never starts", () => {
  for (const [file, source] of Object.entries(app)) {
    if (file === "FamilyAssistWebRtc.swift") continue;
    assert.doesNotMatch(source, /RTCInitializeSSL\(|RTCPeerConnectionFactory\(/, `${file} sets up WebRTC itself`);
  }
  for (const source of [app["FamilyAssistWebRtc.swift"], broadcast]) {
    assert.equal((source.match(/RTCInitializeSSL\(\)/g) ?? []).length, 1);
    assert.equal((source.match(/RTCPeerConnectionFactory\(/g) ?? []).length, 1);
    assert.match(source, /useManualAudio = true/);
    assert.match(source, /isAudioEnabled = false/);
  }
  assert.match(app["FamilyAssistViewerPeer.swift"], /factory = FamilyAssistWebRtc\.makeFactory\(\)/);
});

test("one serial queue per peer; sockets are invalidated and torn down in order", () => {
  for (const source of [app["FamilyAssistViewerPeer.swift"], broadcast]) {
    assert.match(source, /DispatchQueue\(label: "app\.apollo\.familyassist\.(viewer|broadcast)"\)/);
    assert.match(source, /delegateQueue\.underlyingQueue = queue/);
    assert.match(source, /delegateQueue\.maxConcurrentOperationCount = 1/);
    assert.match(source, /session\?\.invalidateAndCancel\(\)/, "URLSession keeps its delegate until invalidated");
    assert.match(source, /didCompleteWithError error: Error\?\)/, "a dropped connection ends the session");
    assert.match(source, /sendPing/);
    assert.match(source, /\.add\(RTCIceCandidate\(sdp: candidate, sdpMLineIndex: 0, sdpMid: "0"\)\) \{ _ in \}/, "chained candidate API");
    const teardown = source.slice(source.indexOf(source.includes("func closeNow") ? "func closeNow" : "func teardown"));
    const steps = ["peer?.close()", "factory = nil"].map((step) => teardown.indexOf(step));
    assert.ok(steps[0] >= 0 && steps[1] > steps[0], "connection closes before the factory goes");
  }
  // Every WebRTC callback hops onto the queue before touching state.
  assert.match(broadcast, /didGenerate candidate: RTCIceCandidate\) \{\s*queue\.async/);
  assert.match(app["FamilyAssistViewerPeer.swift"], /didGenerate candidate: RTCIceCandidate\) \{\s*queue\.async/);
});

test("the helper's picture is drawn and hidden on the main thread only", () => {
  const view = app["FamilyAssistViewerView.swift"];
  assert.match(view, /final class FamilyAssistRenderer: NSObject, RTCVideoRenderer/);
  assert.match(view, /func setPaused\(_ value: Bool\) \{\s*DispatchQueue\.main\.async/);
  assert.match(view, /override func didMoveToWindow\(\)[\s\S]*detach\(video\)[\s\S]*attach\(video\)/);
  const peer = app["FamilyAssistViewerPeer.swift"];
  assert.doesNotMatch(peer, /isHidden|RTCMTLVideoView/, "the peer never touches a view");
  assert.match(peer, /track\.add\(FamilyAssistRenderer\.shared\)/);
  assert.match(peer, /remoteTrack\?\.remove\(FamilyAssistRenderer\.shared\)/);
  assert.match(peer, /didOpen dataChannel: RTCDataChannel\) \{ dataChannel\.close\(\) \}/);
});

test("the Broadcast extension: video only, gate closed before release, turns with the iPad, keeps the screen's shape", () => {
  assert.match(broadcast, /guard sampleBufferType == \.video else \{ return \}/);
  assert.doesNotMatch(broadcast, /audioApp|audioMic/);
  const finish = broadcast.slice(broadcast.indexOf("private func finish"), broadcast.indexOf("private func failTransport"));
  const order = ["frames.close()", "publish(", "\"terminate\"", "self.teardown()", "finishBroadcastWithError"].map((step) => finish.indexOf(step));
  assert.ok(order.every((i) => i >= 0), "every ending step is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "ending order");
  assert.match(finish, /guard !finished else \{ completion\?\(\); return \}/);
  assert.match(broadcast, /seconds\.isFinite/, "an invalid timestamp would trap converting to Int64");
  assert.match(broadcast, /RPVideoSampleOrientationKey/);
  assert.doesNotMatch(broadcast, /adaptOutputFormat\(toWidth: 1280, height: 720/, "a fixed 16:9 crops a phone screen");
  assert.match(broadcast, /videoSource\(forScreenCast: true\)/);
  assert.match(broadcast, /RTCVideoCapturer\(delegate: source\)/);
  assert.doesNotMatch(broadcast.slice(broadcast.indexOf("func push")), /RTCVideoCapturer\(/, "one capturer, not one per frame");
});

test("owner commands reach the extension at once, and its state reaches the app", () => {
  assert.match(broadcast, /CFNotificationCenterAddObserver\([\s\S]*?commandNotification as CFString/);
  assert.match(broadcast, /CFNotificationCenterRemoveObserver/);
  assert.match(broadcast, /issuedAt > lastCommandAt/, "each command is applied once");
  assert.match(broadcast, /CFNotificationCenterPostNotification\(CFNotificationCenterGetDarwinNotifyCenter\(\), CFNotificationName\(stateNotification as CFString\)/);
  const module = app["ApolloFamilyAssistModule.swift"];
  assert.match(module, /CFNotificationCenterAddObserver\([\s\S]*?stateNotification as CFString/);
  assert.match(module, /CFNotificationCenterPostNotification\(CFNotificationCenterGetDarwinNotifyCenter\(\), CFNotificationName\(commandNotification as CFString\)/);
  assert.match(module, /AsyncFunction\("startCapture"\)[\s\S]*?\}\.runOnQueue\(\.main\)/, "the picker is a view: main thread");
  const stop = module.slice(module.indexOf('AsyncFunction("stopCapture")'), module.indexOf('AsyncFunction("startViewer")'));
  assert.match(stop, /removeHandoff\(\)/, "a broadcast started after Stop finds nothing to share");
  for (const key of ["family-assist-command", "family-assist-extension-state", "family-assist-handoff.json", "app.apollo.familyassist.command", "app.apollo.familyassist.state"]) {
    assert.ok(module.includes(`"${key}"`) && broadcast.includes(`"${key}"`), `app and extension agree on ${key}`);
  }
});

test("the extension only sends termination reasons the server accepts from the sharer", () => {
  const sessions = readFileSync(new URL("../../backend/services/family_assist/sessions.py", import.meta.url), "utf8");
  const accepted = sessions.match(/allowed = \{([^}]*)\} if role == "sharer"/)![1].match(/"([a-z_]+)"/g)!.map((s) => s.replaceAll('"', "")).sort();
  const wire = broadcast.match(/wireReasons: Set<String> = \[([^\]]*)\]/)![1].match(/"([a-z_]+)"/g)!.map((s) => s.replaceAll('"', "")).sort();
  assert.deepEqual(wire, accepted);
  assert.match(broadcast, /wireReasons\.contains\(reason\) \? reason : "transport_failed"/);
});

test("the app and the extension agree on the handoff fields", () => {
  const fields = (source: string, name: string) => source.slice(source.indexOf(`struct ${name}`)).match(/let (\w+): /g)!.slice(0, 7).map((s) => s.slice(4, -2));
  assert.deepEqual(fields(app["ApolloFamilyAssistModule.swift"], "FamilyAssistHandoff"), fields(broadcast, "Handoff"));
});

test("the Broadcast target is versioned like the app and named ApolloSG", () => {
  const plugin = read("modules/apollo-family-assist/plugin/withApolloFamilyAssist.js");
  assert.match(plugin, /settings\.MARKETING_VERSION = config\.version/);
  assert.match(plugin, /settings\.CURRENT_PROJECT_VERSION = \(config\.ios && config\.ios\.buildNumber\)/);
  assert.match(plugin, /settings\.PRODUCT_BUNDLE_IDENTIFIER = `"\$\{BUNDLE\}"`/);
  assert.match(read(IOS + "Broadcast/Info.plist"), /<key>CFBundleDisplayName<\/key><string>ApolloSG Family Help<\/string>/);
});
