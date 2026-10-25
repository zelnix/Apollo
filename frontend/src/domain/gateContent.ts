// Static content for individual Gate Details screens.
// Each gate's plain-English explanation of what it does, how it works,
// and its coverage & limitations. All content describes REAL existing
// capabilities — it never invents features or access Apollo does not have.

import type { GateId } from "./gates";

export interface GateContent {
  /** Concise description of the gate's protective responsibility. */
  whatItDoes: string;
  /** How the protection mechanism actually works. */
  howItWorks: string[];
  /** What this gate can protect. */
  coverage: string[];
  /** What it cannot access or inspect, including device/OS limitations. */
  limitations: string[];
}

export const GATE_CONTENT: Record<GateId, GateContent> = {
  site: {
    whatItDoes:
      "Website protection filters internet traffic to block known dangerous websites before they load on your device. It works in the background using device-level DNS filtering.",
    howItWorks: [
      "Uses a local VPN configuration to inspect DNS requests from your device.",
      "Compares requested websites against known dangerous destinations.",
      "Blocks connections to confirmed malicious sites before they load.",
      "Runs continuously in the background when enabled and permissions are granted.",
    ],
    coverage: [
      "Known phishing websites and scam domains.",
      "Confirmed malware distribution sites.",
      "Deceptive websites that impersonate legitimate services.",
    ],
    limitations: [
      "Requires VPN permission to filter traffic — no other VPN can be active at the same time.",
      "Encrypted DNS (Private DNS on Android) may bypass Apollo's filtering.",
      "Cannot inspect the content of encrypted (HTTPS) web pages.",
      "New or unknown malicious websites may not be in the block list immediately.",
    ],
  },

  link: {
    whatItDoes:
      "Link checking analyses where a URL really leads and looks for scams, fake websites, phishing pages and harmful downloads. It works on demand when you submit a link or when another Gate triggers it.",
    howItWorks: [
      "Resolves the full destination of shortened or redirected links.",
      "Checks the destination against known scam and phishing databases.",
      "Analyses the page content and structure for signs of deception.",
      "Runs when you submit a link or when triggered by another protection.",
    ],
    coverage: [
      "Any URL you paste, share or submit for checking.",
      "Links detected in messages or emails by other Gates.",
      "Shortened links, redirects and obfuscated URLs.",
    ],
    limitations: [
      "Does not monitor links in the background — responds when triggered.",
      "Cannot check links inside apps that don't allow sharing.",
      "Requires an internet connection for full reputation checks.",
      "Very new malicious URLs may not yet be in threat databases.",
    ],
  },

  text: {
    whatItDoes:
      "Message screening looks for scam messages, fake alerts, urgent payment requests and dangerous links in supported message sources. It captures and assesses new-message events in the background where permissions allow.",
    howItWorks: [
      "Monitors supported new-message notifications when permission is granted.",
      "Analyses message content for scam patterns, urgency tactics and deceptive language.",
      "Checks any embedded links against known dangerous destinations.",
      "You can also manually check any message by pasting, sharing or screenshotting it.",
    ],
    coverage: [
      "SMS and supported messaging app notifications.",
      "Scam patterns including fake delivery notices, bank alerts and prize claims.",
      "Dangerous links embedded in messages.",
    ],
    limitations: [
      "Requires notification access permission for background monitoring.",
      "Cannot read messages inside end-to-end encrypted apps directly.",
      "Manual checks work for any message — paste, share or screenshot it.",
      "Historical messages are not automatically re-scanned.",
    ],
  },

  call: {
    whatItDoes:
      "Call screening checks suspicious callers and phone numbers and helps you decide whether it is safe to respond. It can screen incoming calls automatically when configured.",
    howItWorks: [
      "Checks incoming numbers against block and allow lists.",
      "Looks up unknown numbers for known scam associations.",
      "When automatic checking is enabled, assesses incoming calls in real time.",
      "You can also manually check any number or caller before responding.",
    ],
    coverage: [
      "Incoming calls from unknown or suspicious numbers.",
      "Known scam and robocall numbers.",
      "Numbers you want to verify before calling back.",
    ],
    limitations: [
      "Requires call screening permission on supported devices.",
      "Cannot listen to or record call content.",
      "Caller ID spoofing may bypass number-based checks.",
      "Not available on all devices or operating system versions.",
    ],
  },

  network: {
    whatItDoes:
      "Internet monitoring reports the connection you are using and whether Apollo's protection is operating. It watches for unsafe connections and network changes that could affect your security.",
    howItWorks: [
      "Checks your current connection type (Wi-Fi or mobile data) on every app open.",
      "Detects network changes and re-evaluates connection safety.",
      "Warns about connections to unsecured or suspicious networks.",
      "When website protection is active, provides continuous background monitoring.",
    ],
    coverage: [
      "Wi-Fi network identification and safety assessment.",
      "Mobile data connection status.",
      "Detection of network configuration changes.",
    ],
    limitations: [
      "Foreground checks happen on app open and network change — not continuously unless website protection is active.",
      "Cannot inspect traffic on networks it cannot observe.",
      "Public Wi-Fi assessments are based on observable network properties.",
      "VPN connections from other apps may limit network visibility.",
    ],
  },

  account: {
    whatItDoes:
      "Account alerts investigate warnings about your accounts — login attempts, password reset requests, breach notifications and MFA alerts — and help you take the right recovery steps.",
    howItWorks: [
      "Analyses account security alerts you receive (login, reset, breach, MFA).",
      "Checks whether alerts are genuine or phishing attempts.",
      "When breach lookup is configured, monitors for exposure in known data breaches.",
      "Guides you through appropriate recovery actions when a real issue is found.",
    ],
    coverage: [
      "Login attempt and password reset alert analysis.",
      "Breach notification verification.",
      "MFA and two-factor authentication alert assessment.",
      "Data breach exposure checks (when configured).",
    ],
    limitations: [
      "Responds when you submit an alert — does not monitor all accounts automatically.",
      "Live breach-list lookup requires backend configuration.",
      "Cannot access or change your account passwords or settings directly.",
      "Relies on known breach databases which may not include very recent breaches.",
    ],
  },

  email: {
    whatItDoes:
      "Email monitoring looks for phishing, impersonation, dangerous links and risky attachments in emails. It can monitor a connected mailbox automatically or check individual emails you share.",
    howItWorks: [
      "When a mailbox is connected, retrieves and assesses new emails automatically.",
      "Checks sender identity for signs of impersonation or spoofing.",
      "Analyses email content, links and attachments for threats.",
      "You can also check any email manually by pasting, sharing or scanning it.",
    ],
    coverage: [
      "Phishing emails with deceptive links or fake login pages.",
      "Impersonation attempts mimicking known contacts or services.",
      "Dangerous attachments and hidden executable content.",
      "Suspicious sender addresses and domain mismatches.",
    ],
    limitations: [
      "Automatic monitoring requires connecting a read-only mailbox.",
      "Connection is optional — manual checks always work.",
      "Cannot access emails in apps that don't support sharing.",
      "Encrypted email content may not be fully analysable.",
    ],
  },

  file: {
    whatItDoes:
      "File checking examines files and attachments for suspicious content, hidden links and signs they may be unsafe. It helps you understand whether a file is safe before you open it.",
    howItWorks: [
      "Analyses file type, structure and content for suspicious patterns.",
      "Checks for hidden links, embedded scripts and executable content.",
      "Compares file signatures against known malware indicators.",
      "Runs when you share or submit a file for checking.",
    ],
    coverage: [
      "Document files (PDF, Office, etc.) shared with ApolloSG.",
      "Downloaded files and email attachments.",
      "Detection of hidden executable content and suspicious macros.",
    ],
    limitations: [
      "Responds when you submit a file — does not scan your entire device automatically.",
      "Cannot access files inside apps that don't allow sharing.",
      "Encrypted or password-protected files may not be fully analysable.",
      "Very new malware variants may not be in signature databases immediately.",
    ],
  },

  app: {
    whatItDoes:
      "App checking examines whether an app's source, permissions and behaviour give you a reason to be cautious — even if it has not been used recently. It helps you make informed decisions about app safety.",
    howItWorks: [
      "Checks the app's source (official store vs. sideloaded).",
      "Reviews requested permissions for anything unusual or excessive.",
      "Looks for known risky behaviours associated with the app.",
      "Runs when you submit an app for checking.",
    ],
    coverage: [
      "Installed apps and apps you are considering installing.",
      "Permission analysis for excessive or unusual access requests.",
      "Source verification (official stores vs. unknown sources).",
    ],
    limitations: [
      "Responds when you submit an app — does not monitor all apps continuously.",
      "Cannot inspect what an app does with data once permission is granted.",
      "App behaviour analysis is based on known patterns and metadata.",
      "System apps and pre-installed apps may have limited analysis available.",
    ],
  },

  device: {
    whatItDoes:
      "Device monitoring checks whether important protections and permissions are working on your device and looks for changes that may need your attention. It provides a health overview of your device's security posture.",
    howItWorks: [
      "Checks device security settings and protection status.",
      "Monitors for changes to important permissions and configurations.",
      "Verifies that Apollo's own protections have the access they need.",
      "Runs periodic checks and provides a full device health assessment on demand.",
    ],
    coverage: [
      "Operating system security settings (screen lock, encryption, etc.).",
      "Apollo's permission status and protection configuration.",
      "Detection of changes that could reduce your protection.",
    ],
    limitations: [
      "Cannot modify device settings directly — recommends actions for you to take.",
      "Some settings may not be observable on all Android versions.",
      "Root/jailbreak detection is based on observable indicators.",
      "Manufacturer-specific security features may not be fully assessed.",
    ],
  },
};
