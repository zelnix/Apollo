// A screen title that stays on one line: when the header's icons leave too little room, the font steps down
// (never below minSize) instead of wrapping "Ask Higgins" onto two lines. Works the same on web and native.
import React, { useState } from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";

import { fittedSize } from "@/src/utils/fitTitle";

export function FitTitle({ text, style, maxSize = 28, minSize = 20, testID }: { text: string; style: StyleProp<TextStyle>; maxSize?: number; minSize?: number; testID?: string }) {
  const [available, setAvailable] = useState(0);
  return (
    <View style={{ flex: 1, minWidth: 0 }} onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}>
      <Text style={[style, { fontSize: fittedSize(text, available, maxSize, minSize) }]} testID={testID}>{text}</Text>
    </View>
  );
}
