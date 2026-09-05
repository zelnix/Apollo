// Benchmark runner: runs the labelled corpus through the on-device engine +
// backend intelligence (one batch round-trip) and scores against launch gates.

import { apiPost } from "@/src/api/client";
import { decide } from "@/src/domain/decision";
import { minimalIndicator } from "@/src/domain/privacy";
import { analyseUrlLocally } from "@/src/domain/risk";
import type { ApolloState, IntelResult } from "@/src/domain/types";
import corpus from "./corpus.json";

export const GATES = { detectionMin: 0.9, falsePositiveMax: 0.02 } as const;

export interface BenchmarkRow { url: string; label: "threat" | "clean"; state: ApolloState; localScore: number; intelVerdict: IntelResult["verdict"] | "error"; detected: boolean; falsePositive: boolean }

export interface BenchmarkReport {
  ranAt: string;
  corpusVersion: string;
  threats: number;
  clean: number;
  detected: number; // threat → growling/barking/biting
  detectedBarking: number; // threat → barking (action) — stricter view
  falsePositives: number; // clean → anything but resting
  detectionRate: number;
  barkingRate: number;
  falsePositiveRate: number;
  intelCoverage: "full" | "partial" | "none";
  gates: { detection: boolean; falsePositive: boolean; pass: boolean };
  rows: BenchmarkRow[];
}

interface BatchItem { value: string; result: IntelResult | null; error: string | null }

export async function runBenchmark(onProgress?: (done: number, total: number) => void): Promise<BenchmarkReport> {
  const items: { url: string; label: "threat" | "clean" }[] = [
    ...corpus.threats.map((url) => ({ url, label: "threat" as const })),
    ...corpus.clean.map((url) => ({ url, label: "clean" as const })),
  ];
  const locals = items.map((i) => analyseUrlLocally(i.url));
  const indicators = locals.map((l) => (l.normalizedUrl ? minimalIndicator(l.normalizedUrl) : l.input));
  onProgress?.(0, items.length);

  let batch: BatchItem[] = [];
  try {
    batch = await apiPost<BatchItem[]>("/intel/check-batch", "intel_check", { indicator_type: "url", values: indicators } as unknown as Record<string, unknown>);
  } catch {
    batch = indicators.map((value) => ({ value, result: null, error: "unavailable" }));
  }
  onProgress?.(items.length, items.length);

  const rows: BenchmarkRow[] = items.map((item, i) => {
    const intel = batch[i]?.result ?? null;
    const d = decide(locals[i], intel, false);
    const detected = item.label === "threat" && d.state !== "resting";
    const falsePositive = item.label === "clean" && d.state !== "resting";
    return { url: item.url, label: item.label, state: d.state, localScore: locals[i].score, intelVerdict: intel?.verdict ?? "error", detected, falsePositive };
  });
  const threats = corpus.threats.length, clean = corpus.clean.length;
  const detected = rows.filter((r) => r.detected).length;
  const detectedBarking = rows.filter((r) => r.label === "threat" && (r.state === "barking" || r.state === "biting")).length;
  const falsePositives = rows.filter((r) => r.falsePositive).length;
  const coverages = batch.map((b) => b.result?.coverage ?? "none");
  const intelCoverage: BenchmarkReport["intelCoverage"] = coverages.every((c) => c === "full") ? "full" : coverages.some((c) => c !== "none") ? "partial" : "none";
  const detectionRate = detected / threats, falsePositiveRate = falsePositives / clean;
  const gates = { detection: detectionRate >= GATES.detectionMin, falsePositive: falsePositiveRate < GATES.falsePositiveMax, pass: false };
  gates.pass = gates.detection && gates.falsePositive;
  return { ranAt: new Date().toISOString(), corpusVersion: corpus.version, threats, clean, detected, detectedBarking, falsePositives, detectionRate, barkingRate: detectedBarking / threats, falsePositiveRate, intelCoverage, gates, rows };
}
