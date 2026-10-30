/**
 * Private DNS advice — what Higgins asks the person to change, from what Android actually reported.
 *
 * Higgins recommends Automatic. Two settings get a prompt:
 *   • Off — lookups are never encrypted by Android.
 *   • A provider hostname — Android sends every lookup straight to that provider, so Apollo's
 *     website checks never see them.
 * Automatic needs nothing: lookups still go to the DNS server the network (or Apollo's tunnel)
 * declares, so Apollo keeps checking them. When Android reports Automatic on a network that doesn't
 * support encrypted lookups, Higgins confirms the setting and explains the network — it never asks
 * for Automatic again. When Android can't say which of Off / Automatic is set, the advice says
 * exactly that rather than guessing; a failed read gives no advice at all.
 *
 * Pure: no React, no native calls.
 */
import type { PrivateDnsMode, PrivateDnsStatus } from "./types";

export interface PrivateDnsAdvice {
  id: "off" | "hostname" | "not_in_use";
  title: string;
  body: string;
  actionLabel: string;
}

/** Where the setting lives when the direct screen can't be opened. */
export const PRIVATE_DNS_SETTINGS_PATH = "Settings → Network & internet → Private DNS (Samsung: Settings → Connections → More connection settings → Private DNS)";

const ACTION_LABEL = "Open Private DNS settings";

/** The mode, also for native builds that only report the active/server pair. A read that failed
 *  (unobservable) is "unknown" — never "not in use", which would prompt a change nobody needs. */
export function privateDnsMode(status: PrivateDnsStatus): PrivateDnsMode {
  if (status.mode) return status.mode;
  if (status.privateDnsServer) return "hostname";
  if (status.bypassLevel === "unobservable") return "unknown";
  return status.privateDnsActive ? "automatic" : "not_in_use";
}

/** Android reports Automatic, but this network doesn't support encrypted lookups. Nothing to change:
 *  the setting is confirmed and the network is explained. Null whenever that isn't what Android said. */
export function privateDnsNote(status: PrivateDnsStatus | null | undefined): string | null {
  if (!status || privateDnsMode(status) !== "automatic" || status.privateDnsActive) return null;
  return "Private DNS is set to Automatic. This network doesn’t support encrypted website lookups right now, so Android uses the network’s usual lookups. Apollo’s website checks still work. You don’t need to change anything.";
}

export function privateDnsAdvice(status: PrivateDnsStatus | null | undefined): PrivateDnsAdvice | null {
  if (!status) return null;
  const mode = privateDnsMode(status);
  if (mode === "off") {
    return {
      id: "off",
      title: "Set Private DNS to Automatic",
      body: "Private DNS is Off on this device. Higgins recommends Automatic: Android then encrypts website lookups whenever the network supports it, and Apollo’s website checks keep working alongside it.",
      actionLabel: ACTION_LABEL,
    };
  }
  if (mode === "hostname") {
    const host = status.privateDnsServer ?? "a provider hostname";
    return {
      id: "hostname",
      title: "Private DNS is going around ApolloSG",
      body: `Private DNS is set to ${host}, so Android sends every website lookup straight to ${status.privateDnsServer ? "that provider" : "it"} and Apollo’s website checks never see them. Choose Automatic so Apollo can check websites again.`,
      actionLabel: ACTION_LABEL,
    };
  }
  if (mode === "not_in_use") {
    return {
      id: "not_in_use",
      title: "Check Private DNS is set to Automatic",
      body: "Android says Private DNS isn’t encrypting website lookups on this network. It is either Off, or Automatic on a network that doesn’t support it — Android doesn’t tell ApolloSG which. If it isn’t Automatic, choose Automatic.",
      actionLabel: ACTION_LABEL,
    };
  }
  return null;
}
