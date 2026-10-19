// Improvement 4: "Explain Exactly What Apollo Is Protecting"
// Higgins explanation header for the Protection screen.
// Explains in everyday language what each protection status means
// and distinguishes automatic vs on-demand vs limited vs unavailable.

import type { ProtectionArea, ProtectionAreaId } from "@/src/domain/protectionAreas";

/** Build a Higgins-style explanation for the overall protection status.
 *  Uses actual area data to describe what Apollo is protecting. */
export function buildProtectionExplanation(areas: ProtectionArea[]): string {
  if (areas.length === 0) {
    return "Apollo is checking the current state of your device protection.";
  }

  const automatic = areas.reduce((sum, a) => sum + a.automaticCount, 0);
  const watching = areas.reduce((sum, a) => sum + a.watchingCount, 0);
  const attention = areas.filter((a) => a.attentionCount > 0);

  if (attention.length > 0) {
    const names = attention.map((a) => a.title).join(attention.length === 2 ? " and " : ", ");
    return `${names} ${attention.length === 1 ? "needs" : "need"} your attention. Apollo is still protecting where it can, but some protections require action to restore full coverage.`;
  }

  if (watching === automatic && automatic > 0) {
    return "All available automatic protections are running. Manual checks are ready when you need them. Apollo will let you know if anything changes.";
  }

  if (watching > 0) {
    return `${watching} of ${automatic} automatic protections are confirmed running. The rest are available as manual checks or have known limitations on this device.`;
  }

  return "Apollo has protections available across these areas. Automatic protections run in the background; manual checks are tools you can use anytime.";
}

/** Build a Higgins explanation for a specific protection area capability status. */
export function capabilityStatusExplanation(mode: "automatic" | "manual", statusLabel: string): string {
  if (mode === "automatic") {
    switch (statusLabel.toLowerCase()) {
      case "watching":
        return "Apollo is automatically checking this in the background.";
      case "limited":
        return "Apollo is running this protection but cannot cover everything on this device.";
      case "needs attention":
        return "This automatic protection has a problem that needs your action.";
      case "unavailable":
        return "This protection cannot run on this device right now.";
      case "unsupported":
        return "This protection is not available on this type of device.";
      default:
        return `This protection is currently ${statusLabel.toLowerCase()}.`;
    }
  }

  // Manual mode
  switch (statusLabel.toLowerCase()) {
    case "available":
      return "You can run this check whenever you need it.";
    case "ready":
      return "This check is ready for you to use.";
    case "needs setup":
      return "This check requires some setup before it can be used.";
    default:
      return `This check is ${statusLabel.toLowerCase()}.`;
  }
}

/** Category-level Higgins explanation for what each area protects. */
export const AREA_EXPLANATION: Record<ProtectionAreaId, string> = {
  websites_links: "Apollo checks websites and links you encounter — automatically blocking known dangerous sites and letting you manually verify any link before you tap it.",
  messages_calls: "Apollo can screen messages for scam patterns and help you evaluate suspicious calls. Message screening runs automatically where supported; call checking is available on demand.",
  email_accounts: "Apollo monitors your email and online accounts for signs of compromise or suspicious activity. Some monitoring runs automatically; detailed checks are available when you need them.",
  apps_files: "Apollo can check apps installed on your device and scan files you receive. These checks help you understand what's safe before you open or install something.",
  device_internet: "Apollo monitors your device settings and internet connection for security concerns. It watches for changes that could reduce your protection and alerts you if your network looks unsafe.",
};
