// Where to report a scam: official police/government contacts per region, plus the official website
// (and, for major Australian banks, the 24/7 fraud line) of any bank or brand named in the case.
// Phone numbers were checked against each organisation's own website (June 2026).
import * as Localization from "expo-localization";

import { storage } from "@/src/utils/storage";
import { OFFICIAL_DOMAINS } from "./brand";

export type ReportRegion = "AU" | "NZ" | "UK" | "US" | "CA";
export interface ReportContact { name: string; detail: string; url?: string; phone?: string }

export const REPORT_REGIONS: { id: ReportRegion; label: string }[] = [
  { id: "AU", label: "Australia" }, { id: "NZ", label: "New Zealand" }, { id: "UK", label: "UK" }, { id: "US", label: "US" }, { id: "CA", label: "Canada" },
];

export const OFFICIAL_REPORTING: Record<ReportRegion, ReportContact[]> = {
  AU: [
    { name: "ReportCyber (police)", detail: "Report cybercrime and online fraud to Australian police.", url: "https://www.cyber.gov.au/report" },
    { name: "Scamwatch", detail: "Report the scam to help warn others.", url: "https://www.scamwatch.gov.au/report-a-scam" },
    { name: "IDCARE", detail: "Free help if your identity or details were stolen.", url: "https://www.idcare.org", phone: "1800 595 160" },
  ],
  UK: [
    { name: "Report Fraud (police)", detail: "The UK's national fraud reporting service (formerly Action Fraud).", url: "https://www.reportfraud.police.uk", phone: "0300 123 2040" },
    { name: "Forward scam texts to 7726", detail: "Free to forward suspicious texts to your mobile network.", phone: "7726" },
  ],
  US: [
    { name: "FTC ReportFraud", detail: "Report scams and fraud to the Federal Trade Commission.", url: "https://reportfraud.ftc.gov" },
    { name: "FBI IC3", detail: "Report internet crime to the FBI.", url: "https://www.ic3.gov" },
  ],
  NZ: [
    { name: "NZ Police (105)", detail: "Report scams and fraud to Police online or on the non-emergency line.", url: "https://www.police.govt.nz/use-105/fraud-scam-cyber", phone: "105" },
    { name: "Netsafe", detail: "Help and reporting for online scams.", url: "https://netsafe.org.nz", phone: "0508 638 723" },
    { name: "Forward scam texts to 7726", detail: "Free to forward suspicious texts to the Department of Internal Affairs.", phone: "7726" },
  ],
  CA: [
    { name: "Canadian Anti-Fraud Centre", detail: "Report fraud and cybercrime (phone: weekdays 10 am–4:45 pm ET). Also report it to your local police.", url: "https://reportcyberandfraud.canada.ca", phone: "1-888-495-8501" },
    { name: "Forward scam texts to 7726", detail: "Free to forward suspicious texts to your mobile provider.", phone: "7726" },
  ],
};

/** 24/7 fraud lines for major banks, as published on their official sites. Other brands: website only. */
const BANK_FRAUD_LINES: Record<string, string> = {
  CommBank: "13 2221",
  Westpac: "1300 651 089",
  ANZ: "13 33 50",
  NAB: "13 22 65",
};

export function brandContact(brand: string | null | undefined): ReportContact | null {
  if (!brand) return null;
  const rec = OFFICIAL_DOMAINS.find((b) => b.name.toLowerCase() === brand.trim().toLowerCase());
  if (!rec) return null;
  return {
    name: rec.name,
    detail: "Contact them only through their official website or app, or the number on the back of your card. Never use contact details from the suspicious message.",
    url: `https://${rec.official[0]}`,
    phone: BANK_FRAUD_LINES[rec.name],
  };
}

/** Finds a known brand named in free text (e.g. Higgins's overview). */
export function findBrandIn(text: string): string | null {
  const t = text.toLowerCase();
  return OFFICIAL_DOMAINS.find((b) => new RegExp(`\\b${b.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t))?.name ?? null;
}

const REGION_KEY = "apollo.reporting.region";
export async function loadReportRegion(): Promise<ReportRegion> {
  const saved = await storage.getItem<string | null>(REGION_KEY, null);
  if (saved && REPORT_REGIONS.some((r) => r.id === saved)) return saved as ReportRegion;
  const code = Localization.getLocales()[0]?.regionCode;
  return code === "GB" ? "UK" : code === "US" ? "US" : code === "NZ" ? "NZ" : code === "CA" ? "CA" : "AU";
}
export const saveReportRegion = (r: ReportRegion) => storage.setItem(REGION_KEY, r);
