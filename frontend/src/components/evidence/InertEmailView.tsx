// The Original Email viewer on a phone: the inert document from domain/inertEmail.ts in a locked-down web view.
// No JavaScript, no storage, no cookies, no files, no new windows, no link previews, no phone/address detection, and
// every navigation refused — including ones the web view would otherwise hand to another app. The document itself
// carries no destinations and a policy that blocks every network request.
import React, { useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { WebView } from "react-native-webview";

import { fittedEmail, type InertEmail } from "@/src/domain/inertEmail";

/** Only the document itself may load; anything else (a link, a redirect, an app address) is refused, never opened. */
const onlyTheDocument = (request: { url: string }) => /^about:(blank|srcdoc)$/i.test(request.url);

export function InertEmailView({ email, style, testID }: { email: InertEmail; style?: StyleProp<ViewStyle>; testID?: string }) {
  const [width, setWidth] = useState(0);
  return (
    <View style={[{ overflow: "hidden", backgroundColor: "#FFFFFF" }, style]} testID={testID} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {width ? (
        <WebView
          source={{ html: fittedEmail(email, width) }}
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={onlyTheDocument}
          javaScriptEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          domStorageEnabled={false}
          cacheEnabled={false}
          incognito
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          geolocationEnabled={false}
          mediaPlaybackRequiresUserAction
          allowsInlineMediaPlayback={false}
          allowsLinkPreview={false}
          allowsBackForwardNavigationGestures={false}
          dataDetectorTypes="none"
          textZoom={100}
          nestedScrollEnabled
          style={{ backgroundColor: "#FFFFFF" }}
        />
      ) : null}
    </View>
  );
}
