// Looks up the contacts a check holds in ApolloSG's Official Organisation Directory (POST /official/contacts). Only the
// websites (their host), phone numbers and email addresses, and the organisation the material names, leave the phone;
// nothing is fetched or kept by the server. A failed lookup is reported as "couldn't compare", never as a finding.

import { apiGet, apiPost } from "@/src/api/client";
import { hostOfUrl } from "@/src/domain/urlIntel";
import { namedOrganisation, parseOfficialVerdicts, parseOrganisationNames, type OfficialVerdict, type OrganisationNames } from "@/src/domain/officialContacts";

const MAX = 20;
const NAMES_FOR_MS = 10 * 60 * 1000;
let names: { at: number; list: OrganisationNames[] } | null = null;

async function organisationNames(): Promise<OrganisationNames[]> {
  if (names && Date.now() - names.at < NAMES_FOR_MS) return names.list;
  try {
    names = { at: Date.now(), list: parseOrganisationNames(await apiGet<unknown>("/official/names")) };
  } catch {
    return names?.list ?? [];
  }
  return names.list;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const unique = (values: (string | null | undefined)[]) => Array.from(new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))).slice(0, MAX);

/** The email addresses written in material. */
export function emailsIn(text: string): string[] {
  return unique(text.match(EMAIL_RE) ?? []);
}

/** The directory's verdicts for one check: [] when there's nothing to compare, null when the lookup didn't answer. */
export async function lookupOfficialContacts(input: {
  /** The material's own words, only to tell which listed organisation it names (never sent). */
  text?: string; claimedOrg?: string | null; sites?: string[]; phones?: string[]; emails?: string[];
}): Promise<OfficialVerdict[] | null> {
  const sites = unique((input.sites ?? []).map(hostOfUrl));
  const phones = unique(input.phones ?? []);
  const emails = unique(input.emails ?? []);
  if (!sites.length && !phones.length && !emails.length) return [];
  const listed = await organisationNames();
  const claimed = (input.claimedOrg && namedOrganisation(input.claimedOrg, listed)) || (input.text ? namedOrganisation(input.text, listed) : null);
  try {
    const raw = await apiPost<unknown>("/official/contacts", "official_contacts", {
      ...(claimed ? { claimed_org: claimed } : {}), sites, phones, emails,
    }, { timeoutMs: 10000 });
    return parseOfficialVerdicts(raw);
  } catch {
    return null;
  }
}
