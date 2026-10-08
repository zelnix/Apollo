// Multi-file Share-to-Apollo overview. When several files are shared at once, every file is accounted for
// and inspected individually with the SAME File Gate engine (readInspection + analyseFile) — never a second
// scanner, never a single "all clear" for the batch. Each row shows its own status and verdict, and can be
// opened on its own for the full File Gate flow (Ask Higgins, recovery, links inside).
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { analyseFile, type FileAnalysis } from "@/src/domain/fileAnalysis";
import { readInspection } from "@/src/domain/fileInspection";
import { STATE_NAME } from "@/src/domain/types";
import { putShareIntake } from "@/src/share/shareIntake";
import type { SharedPayload } from "@/src/share/classifyShare";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

type SharedFile = NonNullable<SharedPayload["files"]>[number];
type Status = "waiting" | "checking" | "checked" | "failed";
interface Row { file: SharedFile; status: Status; analysis?: FileAnalysis; readable?: boolean }

const useStyles = makeStyles((c) => ({
  name: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  verdict: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
}));

function statusLabel(r: Row): string {
  if (r.status === "waiting") return "Waiting";
  if (r.status === "checking") return "Checking…";
  if (r.status === "failed") return "Couldn't check";
  return r.analysis ? STATE_NAME[r.analysis.state] : "Checked";
}

function fileName(f: SharedFile): string { return f.fileName || f.path.split("/").pop() || "shared file"; }

export function ShareFileBatch({ files }: { files: SharedFile[] }) {
  const s = useStyles(); const { colors } = useTheme(); const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => files.map((file) => ({ file, status: "waiting" })));
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; started.current = true;
    let active = true;
    (async () => {
      for (let i = 0; i < files.length; i++) {
        if (!active) return;
        setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "checking" } : r));
        const file = files[i];
        try {
          const inspected = await readInspection({ uri: file.path, size: file.size });
          const analysis = analyseFile({ name: fileName(file), size: file.size ?? undefined, mime: file.mimeType ?? null, ...inspected, source: "unknown", passwordInMessage: false });
          if (!active) return;
          setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "checked", analysis, readable: !inspected.inspectionError } : r));
        } catch {
          if (!active) return;
          setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "failed" } : r));
        }
      }
    })();
    return () => { active = false; };
  }, [files]);

  const openOne = (file: SharedFile) => {
    const intakeId = putShareIntake({ files: [file] });
    router.replace({ pathname: "/file", params: { source: "unknown", sharedIntakeId: intakeId } });
  };

  const checkedCount = rows.filter((r) => r.status === "checked").length;

  return (
    <View style={{ gap: spacing.md }} testID="share-file-batch">
      <Body testID="share-file-batch-count">{files.length} files shared. Apollo checks each one on its own — a batch is never marked safe because a single file looked fine.</Body>
      {rows.map((r, i) => (
        <Card key={`${r.file.path}-${i}`} style={{ gap: spacing.sm, borderColor: r.analysis ? toneColor(colors, r.analysis.state) : undefined }} testID={`share-file-${i}`}>
          <View style={s.head}>
            <Text style={s.name} numberOfLines={1}>{fileName(r.file)}</Text>
            <Pill tone={r.analysis ? r.analysis.state : r.status === "failed" ? "growling" : "neutral"} label={statusLabel(r)} testID={`share-file-${i}-status`} />
          </View>
          <Text style={s.meta}>{r.file.mimeType || "unknown type"}{r.file.size != null ? ` · ${Math.max(1, Math.round(r.file.size / 1024))} KB` : ""}</Text>
          {r.status === "checked" && r.analysis ? (
            <>
              <Text style={s.verdict} testID={`share-file-${i}-verdict`}>{r.analysis.verdict}</Text>
              {!r.readable ? <Text style={s.meta} testID={`share-file-${i}-unreadable`}>Apollo could not read this file&apos;s contents — the check used the name and type only.</Text> : null}
              <Button testID={`share-file-${i}-open`} variant="secondary" label="Check this file on its own" onPress={() => openOne(r.file)} />
            </>
          ) : r.status === "failed" ? (
            <>
              <Text style={s.verdict} testID={`share-file-${i}-failed`}>Apollo couldn&apos;t open this file to check it. It may have expired or be inaccessible — share it again.</Text>
              <Button testID={`share-file-${i}-open`} variant="secondary" label="Try this file on its own" onPress={() => openOne(r.file)} />
            </>
          ) : null}
        </Card>
      ))}
      <SectionTitle>{checkedCount} of {files.length} checked</SectionTitle>
    </View>
  );
}
