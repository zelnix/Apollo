// Renders Apollo's rule book word for word. Tables become stacked cards so they read on a phone:
// the first cell is the card's title, every other cell is shown under its column heading.
import React from "react";
import { Platform, Text, View } from "react-native";

import type { Block, Span } from "@/src/domain/ruleBook";
import { fonts, makeStyles, radius, spacing } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { gap: spacing.md },
  h1: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  h2: { fontFamily: fonts.displayBold, fontSize: 19, color: c.onSurface, marginTop: spacing.md },
  h3: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface, marginTop: spacing.sm },
  body: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  indent: { paddingLeft: spacing.lg },
  bold: { fontFamily: fonts.textSemibold },
  italic: { fontStyle: "italic", color: c.onSurfaceSecondary },
  code: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontSize: 13, backgroundColor: c.goldTint },
  list: { gap: spacing.xs },
  itemRow: { flexDirection: "row", gap: spacing.sm },
  marker: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 22, color: c.brand, minWidth: 18 },
  table: { gap: spacing.sm },
  rowCard: { borderWidth: 1, borderColor: c.divider, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, backgroundColor: c.surface },
  rowTitle: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 21, color: c.onSurface },
  cellLabel: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: c.muted, marginTop: spacing.xs },
  cellText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  rule: { height: 1, backgroundColor: c.divider, marginVertical: spacing.sm },
}));

function Inline({ spans, style }: { spans: Span[]; style: object }) {
  const s = useStyles();
  return (
    <Text style={style} selectable>
      {spans.map((span, i) => (
        <Text key={i} style={[span.bold && s.bold, span.italic && s.italic, span.code && s.code]}>{span.text}</Text>
      ))}
    </Text>
  );
}

export function RuleBookView({ blocks, onHeadingLayout, testID = "rule-book" }: {
  blocks: Block[];
  /** y of each heading that carries an {#id}, relative to this view — for opening the book at a section. */
  onHeadingLayout?: (id: string, y: number) => void;
  testID?: string;
}) {
  const s = useStyles();
  return (
    <View style={s.root} testID={testID}>
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <Text key={i} accessibilityRole="header" style={block.level === 1 ? s.h1 : block.level === 2 ? s.h2 : s.h3}
              testID={block.id ? `rule-book-section-${block.id}` : undefined}
              onLayout={block.id && onHeadingLayout ? (e) => onHeadingLayout(block.id!, e.nativeEvent.layout.y) : undefined}>
              {block.text}
            </Text>
          );
        }
        if (block.kind === "paragraph") return <Inline key={i} spans={block.spans} style={[s.body, block.indent && s.indent]} />;
        if (block.kind === "rule") return <View key={i} style={s.rule} />;
        if (block.kind === "list") {
          return (
            <View key={i} style={s.list}>
              {block.items.map((item, j) => (
                <View key={j} style={[s.itemRow, { paddingLeft: item.depth * spacing.lg }]}>
                  <Text style={s.marker}>{item.marker}</Text>
                  <Inline spans={item.spans} style={[s.body, { flex: 1 }]} />
                </View>
              ))}
            </View>
          );
        }
        const twoColumns = block.headers.length <= 2;
        return (
          <View key={i} style={s.table}>
            {block.rows.map((row, j) => (
              <View key={j} style={s.rowCard} testID={`rule-book-row-${i}-${j}`}>
                <Inline spans={row[0] ?? []} style={s.rowTitle} />
                {row.slice(1).map((cell, k) => (
                  <View key={k}>
                    {twoColumns ? null : <Text style={s.cellLabel}>{block.headers[k + 1]}</Text>}
                    <Inline spans={cell} style={s.cellText} />
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
