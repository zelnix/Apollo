import React from "react";
import { Text, View } from "react-native";

import { Body, Card, toneColor } from "@/src/components/ui";
import { hasLocalEvidence } from "@/src/domain/higginsNarration";
import type { PatrolEnforcementEvidence, PatrolEvent, PatrolRecord } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  content: { gap: spacing.lg },
  sub: {
    fontFamily: fonts.display,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  big: {
    fontFamily: fonts.textMedium,
    fontSize: 16,
    lineHeight: 24,
    color: c.onSurface,
  },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  evidenceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: spacing.xs,
  },
  evidenceLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    flex: 1,
  },
  evidenceValue: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurface,
    flex: 2,
    textAlign: "right",
  },
  provenanceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  provenanceText: {
    fontFamily: fonts.textSemibold,
    fontSize: 12,
  },
  provenanceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  divider: {
    height: 1,
    backgroundColor: c.divider,
    marginVertical: spacing.xs,
  },
}));

function provenanceInfo(prov: string | undefined): {
  label: string;
  description: string;
  tone: "resting" | "ears_up" | "unknown";
} {
  switch (prov) {
    case "local_device":
      return {
        label: "On-device evidence",
        description:
          "This evidence was collected directly on your device with full detail.",
        tone: "resting",
      };
    case "dns_observation":
      return {
        label: "DNS observation",
        description:
          "Apollo observed a DNS query for this hostname through the device gateway.",
        tone: "resting",
      };
    case "server_projected":
      return {
        label: "Server-synced summary",
        description:
          "This is a privacy-preserving summary synced from the server. Full detail is on the originating device.",
        tone: "ears_up",
      };
    default:
      return {
        label: "Limited evidence",
        description:
          "The full evidence for this finding is only available on the device where it happened.",
        tone: "unknown",
      };
  }
}

function EvidenceRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const s = useStyles();
  if (!value) return null;
  return (
    <View style={s.evidenceRow}>
      <Text style={s.evidenceLabel}>{label}</Text>
      <Text style={s.evidenceValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function EnforcementEvidenceCard({
  evidence,
}: {
  evidence: PatrolEnforcementEvidence;
}) {
  const s = useStyles();
  return (
    <Card style={{ gap: spacing.sm }} testID="evidence-enforcement">
      <Text style={s.sub}>Enforcement record</Text>
      <EvidenceRow label="Mechanism" value={evidence.mechanism} />
      <EvidenceRow label="Direction" value={evidence.direction} />
      <EvidenceRow label="Protocol" value={evidence.protocol} />
      <EvidenceRow label="Destination" value={evidence.destination_domain || evidence.destination_ip} />
      {evidence.destination_port ? (
        <EvidenceRow label="Port" value={String(evidence.destination_port)} />
      ) : null}
      <EvidenceRow label="Action taken" value={evidence.enforced_action} />
      <EvidenceRow label="Result" value={evidence.result} />
      <EvidenceRow label="Confidence" value={evidence.confidence} />
      <EvidenceRow label="Platform" value={`${evidence.platform}${evidence.os_version ? " " + evidence.os_version : ""}`} />
      <Text style={s.meta}>
        Observed {new Date(evidence.observed_at).toLocaleString()}
      </Text>
    </Card>
  );
}

export function EvidenceTab({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const isLocal = hasLocalEvidence(event);
  const prov = provenanceInfo(event.evidence_provenance);
  const record: PatrolRecord | undefined = event.patrol_record ?? undefined;

  return (
    <View style={s.content}>
      {/* Evidence provenance */}
      <Card style={{ gap: spacing.md }} testID="evidence-provenance-card">
        <Text style={s.sub}>Evidence source</Text>
        <View
          style={[
            s.provenanceBadge,
            { backgroundColor: toneColor(colors, prov.tone) + "18" },
          ]}
        >
          <View
            style={[
              s.provenanceDot,
              { backgroundColor: toneColor(colors, prov.tone) },
            ]}
          />
          <Text
            style={[
              s.provenanceText,
              { color: toneColor(colors, prov.tone) },
            ]}
          >
            {prov.label}
          </Text>
        </View>
        <Body>{prov.description}</Body>
      </Card>

      {/* Recorded indicator */}
      {isLocal && event.local_indicator ? (
        <Card style={{ gap: spacing.sm }} testID="evidence-indicator">
          <Text style={s.sub}>Recorded indicator</Text>
          <Text style={s.big} selectable>
            {event.local_indicator}
          </Text>
          {event.indicator_host ? (
            <Text style={s.meta}>Host: {event.indicator_host}</Text>
          ) : null}
          {event.indicator_digest ? (
            <Text style={s.meta} selectable>
              Digest: {event.indicator_digest}
            </Text>
          ) : null}
        </Card>
      ) : event.indicator_host ? (
        <Card style={{ gap: spacing.sm }} testID="evidence-host">
          <Text style={s.sub}>Indicator host</Text>
          <Text style={s.big} selectable>
            {event.indicator_host}
          </Text>
        </Card>
      ) : null}

      {/* Enforcement evidence (block records) */}
      {event.enforcement_evidence ? (
        <EnforcementEvidenceCard evidence={event.enforcement_evidence} />
      ) : null}

      {/* Supporting references */}
      {event.supporting_references && event.supporting_references.length > 0 ? (
        <Card style={{ gap: spacing.sm }} testID="evidence-references">
          <Text style={s.sub}>Supporting references</Text>
          {event.supporting_references.map((ref, i) => (
            <View key={i} style={{ gap: 2 }}>
              <Text style={[s.big, { fontSize: 14 }]}>{ref.label}</Text>
              <Text style={s.meta} selectable>
                {ref.url}
              </Text>
              {i < event.supporting_references!.length - 1 ? (
                <View style={s.divider} />
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      {/* Domain / registration info */}
      {record?.scenarioContext?.indicatorHost ? (
        <Card style={{ gap: spacing.sm }} testID="evidence-domain-info">
          <Text style={s.sub}>Domain details</Text>
          <EvidenceRow label="Host" value={record.scenarioContext.indicatorHost} />
          {record.freshness ? (
            <EvidenceRow
              label="First observed"
              value={new Date(record.freshness.observedAt).toLocaleString()}
            />
          ) : null}
        </Card>
      ) : null}

      {/* Timestamps */}
      <Card style={{ gap: spacing.sm }} testID="evidence-timestamps">
        <Text style={s.sub}>Timestamps</Text>
        <EvidenceRow
          label="Occurred"
          value={new Date(event.occurred_at).toLocaleString()}
        />
        {event.resolved_at ? (
          <EvidenceRow
            label="Resolved"
            value={new Date(event.resolved_at).toLocaleString()}
          />
        ) : null}
        {record?.freshness?.projectedAt ? (
          <EvidenceRow
            label="Last projected"
            value={new Date(record.freshness.projectedAt).toLocaleString()}
          />
        ) : null}
        {record?.updatedAt ? (
          <EvidenceRow
            label="Last updated"
            value={new Date(record.updatedAt).toLocaleString()}
          />
        ) : null}
      </Card>
    </View>
  );
}
