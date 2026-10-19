// Static content for the Protection Category Details screen.
// Each category's plain-English explanation, "How it works" bullets,
// coverage information and Higgins learning prompt.
//
// All content describes REAL existing capabilities — it never invents
// Gates, enforcement mechanisms or access that Apollo does not have.

import type { ProtectionAreaId } from "./protectionAreas";
import type { GateId } from "./gates";

export interface CategoryContent {
  /** Friendly short description shown under the status pill. */
  shortDescription: string;
  /** Higgins briefing — plain-English summary for the Overview tab. */
  higginsBriefing: string;
  /** "What is [Category] Protection?" paragraph. */
  whatIsIt: string;
  /** "How it works" bullet points. */
  howItWorks: string[];
  /** Coverage bullet points. */
  coverage: string[];
  /** Bottom Higgins learning card title. */
  higginsLearnTitle: string;
  /** Bottom Higgins learning card description. */
  higginsLearnDescription: string;
}

export const CATEGORY_CONTENT: Record<ProtectionAreaId, CategoryContent> = {
  websites_links: {
    shortDescription: "Helps protect against dangerous websites, phishing links and harmful downloads.",
    higginsBriefing:
      "Apollo watches website traffic where your device allows and can check any link you're unsure about. Website filtering works automatically in the background; link checking is available on demand.",
    whatIsIt:
      "Apollo helps look for dangerous websites, deceptive links, and harmful downloads. It uses automatic filtering where the device allows and provides on-demand checking for any link you want to verify.",
    howItWorks: [
      "Filters known dangerous websites automatically where permissions allow",
      "Checks links for scams, phishing and harmful destinations",
      "Uses device permissions for real-time website traffic filtering",
    ],
    coverage: [
      "Automatic website filtering where device permissions allow",
      "On-demand link checking for any URL",
      "Detection of known dangerous destinations",
      "Some websites may not be filtered due to device DNS settings",
    ],
    higginsLearnTitle: "Want to learn how to spot dangerous websites?",
    higginsLearnDescription: "Tap to learn practical tips, real examples, and what to watch for.",
  },
  messages_calls: {
    shortDescription: "Helps protect against scams and malicious links in texts and messaging apps.",
    higginsBriefing:
      "Apollo helps look for suspicious links, risky sender patterns, and scam-style content in supported message sources. Call screening helps assess suspicious callers where supported.",
    whatIsIt:
      "Apollo helps look for suspicious links, risky sender patterns, and scam-style content in supported message sources. Call screening helps you assess suspicious callers and decide whether to respond.",
    howItWorks: [
      "Checks links for known scam or malicious destinations",
      "Looks for suspicious sender or message patterns",
      "Uses supported checks and permissions on your device",
    ],
    coverage: [
      "Works with supported message sources and permissions",
      "Some apps or private content may have limited visibility",
      "Incoming call screening where device permissions allow",
      "Manual checks available for any message or number",
    ],
    higginsLearnTitle: "Want to learn how to spot message scams?",
    higginsLearnDescription: "Tap to learn practical tips, real examples, and what to watch for.",
  },
  email_accounts: {
    shortDescription: "Helps protect against phishing emails, impersonation and account compromise.",
    higginsBriefing:
      "Apollo can monitor connected mailboxes for suspicious emails and watch your accounts for signs of compromise. Email monitoring works automatically when connected; account checks are available on demand.",
    whatIsIt:
      "Apollo monitors your email for phishing, impersonation, dangerous links and risky attachments. It also watches your online accounts for signs of exposure in known data breaches.",
    howItWorks: [
      "Monitors connected mailboxes for suspicious emails",
      "Checks for phishing links and risky attachments",
      "Watches for account exposure in known data breaches",
    ],
    coverage: [
      "Connected email accounts are monitored automatically",
      "Account breach checking for registered email addresses",
      "Manual email checks available for any email",
      "Requires email connection for automatic monitoring",
    ],
    higginsLearnTitle: "Want to learn how to spot phishing emails?",
    higginsLearnDescription: "Tap to learn practical tips, real examples, and what to watch for.",
  },
  apps_files: {
    shortDescription: "Checks apps and files for suspicious content and unsafe behaviour.",
    higginsBriefing:
      "Apollo can check apps installed on your device and scan files you receive. These checks help you understand what's safe before you open or install something.",
    whatIsIt:
      "Apollo checks whether an app's source, permissions and behaviour give you a reason to be cautious. It also checks files and attachments for suspicious content, hidden links and signs they may be unsafe.",
    howItWorks: [
      "Checks app sources, permissions and behaviour",
      "Scans files and attachments for suspicious content",
      "Identifies potential risks before installation or opening",
    ],
    coverage: [
      "On-demand app checking for installed or prospective apps",
      "File scanning for shared or downloaded files",
      "Checks app permissions and known risky behaviours",
      "Cannot access app content that requires special permissions",
    ],
    higginsLearnTitle: "Want to learn how to check app safety?",
    higginsLearnDescription: "Tap to learn practical tips, real examples, and what to watch for.",
  },
  device_internet: {
    shortDescription: "Monitors device health, permissions and internet connection safety.",
    higginsBriefing:
      "Apollo monitors your device settings and internet connection for security concerns. It watches for changes that could reduce your protection and alerts you about unsafe connections.",
    whatIsIt:
      "Apollo checks whether important protections and permissions are working and looks for changes that may need your attention. It also monitors your internet connection, warning you about unsafe connections and network changes.",
    howItWorks: [
      "Monitors device health and protection settings",
      "Watches internet connection safety and changes",
      "Checks for unsafe network configurations",
    ],
    coverage: [
      "Device settings and permissions monitoring",
      "Network connection safety checks on every app open",
      "Alerts for protection changes or unsafe configurations",
      "Continuous background watching when website protection is active",
    ],
    higginsLearnTitle: "Want to learn how to keep your device secure?",
    higginsLearnDescription: "Tap to learn practical tips, real examples, and what to watch for.",
  },
};

/** Icon names per gate for the Gate detail rows. */
export const GATE_ICON: Record<GateId, string> = {
  site: "shield-check",
  link: "link-2",
  text: "message-square",
  call: "phone",
  email: "mail",
  account: "user",
  file: "file-text",
  app: "grid-2x2",
  device: "smartphone",
  network: "wifi",
};
