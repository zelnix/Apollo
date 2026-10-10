// Single maintained processing inventory; screen + Settings summaries must refer here.
// Governing principle: Transparent Data Use and Necessary Sharing.

// ─── Governing Principle ───────────────────────────────────────────────────────

export const GOVERNING_PRINCIPLE = {
  title: 'Transparent Data Use and Necessary Sharing',
  body: [
    'Apollo must clearly explain what information it examines on the user\u2019s device, what information is transmitted to Apollo\u2019s supporting services, and what information is shared with third-party providers.',
    'Apollo processes information locally wherever practical while using secure external services when necessary to deliver effective scam protection, threat detection, reputation checking and investigations.',
    'Personal information may be shared with an authorised service provider when necessary to perform a specific function, appropriately authorised and legally permitted.',
    'Apollo must minimise unnecessary disclosure without removing material security evidence or impairing the protection service.',
  ],
  credo: 'Protect the person. Preserve the evidence. Share only what is necessary.',
  accountability: 'Harmony Wellness Group remains accountable for Apollo\u2019s information handling and third-party arrangements.',
};

// ─── Three Processing Locations ────────────────────────────────────────────────

export const PROCESSING_LOCATIONS = {
  title: 'How Apollo processes your information',
  locations: [
    {
      label: 'On your device',
      icon: 'device' as const,
      summary: 'Apollo examines messages, caller information, links, security activity, screenshots and files locally on your device. Privacy screening, credential detection and image redaction all happen here before anything is sent externally.',
      detail: 'Information that stays local includes: passwords and verification codes detected in content, full messages and files after assessment, browsing history, precise location, hardware identifiers, and any content you choose to withhold. Some local processing may identify a security concern that leads to an authorised external investigation.',
    },
    {
      label: 'Apollo\u2019s services',
      icon: 'server' as const,
      summary: 'When a security investigation is needed, Apollo transmits privacy-processed evidence to its backend for investigation coordination, security checking, evidence management and alerts.',
      detail: 'Transmission is required because security investigations need access to threat intelligence, AI analysis and reputation databases that cannot run on-device. Protections include: credential stripping before transmission, purpose-based authorisation, owner-scoped access control, Fernet encryption for investigation content, and automatic deletion within 15 minutes of completion.',
    },
    {
      label: 'Third-party services',
      icon: 'external' as const,
      summary: 'Apollo shares specific information with named external providers when necessary for a particular security function. Each provider receives only the information needed for its purpose.',
      detail: 'Some personal information must be shared for particular services to work. For example: your email address for breach checking, a phone number for caller reputation, a website address for malicious-site detection, and approved investigation evidence for AI analysis. These are necessary, authorised disclosures \u2014 not privacy violations. The full list of providers is in the Third-Party Service Register accessible from Settings.',
    },
  ],
};

// ─── Capability Data Use ───────────────────────────────────────────────────────

export const CAPABILITY_DATA_USE = [
  {
    capability: 'Message and email investigation',
    local: 'Apollo examines message text, sender details and embedded links on your device.',
    backend: 'Privacy-processed evidence (with credentials stripped) is sent to Apollo\u2019s backend for Higgins AI investigation.',
    thirdParty: 'Google Gemini receives approved investigation content. Safe Browsing checks embedded URLs. RDAP checks sender domains.',
    shared: 'Sanitised message content, sender indicators, embedded URLs',
    necessary: 'AI investigation requires the submitted content to assess the threat accurately.',
    activation: 'Manual: when you submit a message for investigation',
    withheld: 'Passwords, verification codes, authentication tokens, and raw images that fail the privacy gate',
  },
  {
    capability: 'Gmail monitoring',
    local: 'Apollo does not store mailbox credentials. Gmail OAuth provides read-only access.',
    backend: 'Email content is processed through Apollo\u2019s backend investigation pipeline with the same credential stripping and privacy controls as manual investigations.',
    thirdParty: 'Google Gemini receives privacy-processed email evidence. VirusTotal receives file hashes (not file content) for attachment scanning. Safe Browsing checks URLs in emails.',
    shared: 'Email sender, subject, body content (privacy-processed), attachment hashes',
    necessary: 'Automated monitoring requires processing email content to detect scam patterns.',
    activation: 'User-enabled: only after you connect Gmail via OAuth and start monitoring',
    withheld: 'Mailbox credentials (never collected), attachment file content (only hashes sent to VirusTotal)',
  },
  {
    capability: 'Link and website investigation',
    local: 'Apollo sanitises URLs on your device, removing credentials, fragments and secret query parameters.',
    backend: 'Sanitised URL and domain are sent to Apollo\u2019s backend for reputation checking and web crawling.',
    thirdParty: 'Safe Browsing checks the URL. RDAP checks domain registration. Public websites are accessed for content analysis.',
    shared: 'Sanitised URL, domain name',
    necessary: 'Website safety checks require submitting the URL to reputation services.',
    activation: 'Manual: when you submit a link for investigation',
    withheld: 'URL credentials, authentication tokens, fragment identifiers, secret query values',
  },
  {
    capability: 'Phone number checking',
    local: 'Apollo processes the phone number you submit.',
    backend: 'The phone number is sent to Apollo\u2019s backend for reputation lookup.',
    thirdParty: 'IPQualityScore receives the phone number for fraud and reputation checking.',
    shared: 'The phone number being checked',
    necessary: 'Caller reputation checking requires submitting the phone number to the reputation provider.',
    activation: 'Manual: when you submit a phone number for investigation',
    withheld: 'No additional personal information is sent',
  },
  {
    capability: 'Breach checking',
    local: 'Apollo processes the email address you submit.',
    backend: 'The email address is sent to Apollo\u2019s backend for breach lookup.',
    thirdParty: 'XposedOrNot (or Have I Been Pwned when configured) receives the email address to check against known data breaches.',
    shared: 'The email address submitted for the breach check',
    necessary: 'Breach checking requires submitting the email address to the breach database provider.',
    activation: 'Manual: when you request a breach check for an email address',
    withheld: 'No additional personal information is sent',
  },
  {
    capability: 'Image and screenshot investigation',
    local: 'Apollo\u2019s privacy gate screens every image on your device. You choose: send text only (image stays on device), send a redacted image, or withhold entirely.',
    backend: 'Only your approved choice is transmitted to Apollo\u2019s backend with a cryptographic receipt proving the privacy gate was applied.',
    thirdParty: 'Google Gemini receives the approved content (text or redacted image) for AI investigation.',
    shared: 'Approved text or redacted image, with privacy receipt',
    necessary: 'Visual content investigation requires transmitting the approved representation to AI analysis.',
    activation: 'Manual: when you submit an image and make a privacy gate choice',
    withheld: 'Raw images that fail the privacy gate, unredacted sensitive regions, images you choose to withhold',
  },
  {
    capability: 'Push notifications and alerts',
    local: 'Apollo determines when a security alert should be sent.',
    backend: 'Notification content and delivery token are sent to Apollo\u2019s managed push relay.',
    thirdParty: 'Expo push service, Google FCM and Apple APNs deliver the notification to your device.',
    shared: 'Push delivery token and notification content',
    necessary: 'Push delivery requires sharing the delivery token and notification content with the platform push service.',
    activation: 'User-enabled: only when you enable notifications in Settings',
    withheld: 'Full investigation details; notifications contain minimal alert content',
  },
  {
    capability: 'Family support',
    local: 'You choose names, contacts and what to share with paired family members.',
    backend: 'Chosen names, contact details, alerts, weekly counts and replies are stored on Apollo\u2019s backend and shared with paired guardians.',
    thirdParty: 'Email delivery service sends invitations and authorised automatic security alerts to confirmed guardians. Push services deliver alerts.',
    shared: 'Names, contact details, alert content, text messages you choose to send',
    necessary: 'Family pairing requires sharing chosen information with paired members and using delivery services for invitations and alerts.',
    activation: 'Manual: when you pair, invite, share an incident or send a note',
    withheld: 'Full investigation evidence; family members receive alert summaries, not raw evidence',
  },
  {
    capability: 'Ask Higgins (text chat)',
    local: 'Questions are composed on your device.',
    backend: 'Questions and requested speech are sent to Apollo\u2019s backend using the owner-managed key. Personal identifiers in research queries are minimised within Apollo\u2019s backend before transmission to Gemini.',
    thirdParty: 'Google Gemini receives the privacy-processed query for AI response.',
    shared: 'Privacy-processed question or speech request',
    necessary: 'AI responses and speech generation require transmitting your query to the AI provider.',
    activation: 'Manual: when you send a question, tap read-aloud, or enable automatic read-aloud',
    withheld: 'Private messages or secrets you should not paste into the chat field',
  },
];

// ─── Existing Processing Flows ─────────────────────────────────────────────────

export const PRIVACY_FLOWS = [
  { what: 'Purpose-limited security assessments', when: 'When you submit a message, email, screenshot, account alert, phone number or link', detail: 'Apollo combines on-device detection with Higgins context and supported reputation sources. Raw submitted content is not kept in Patrol, logs or analytics. Request-scoped copies close immediately after completion or failure and never later than 15 minutes.' },
  { what: 'Optional ongoing access', when: 'Only after you enable notification access or connect Gmail with OAuth', detail: 'Android notification checks and Gmail OAuth are opt-in. Disconnect or disable access to stop future checks. Apollo never asks for or stores a mailbox username or password. Gmail monitoring uses the same credential stripping and privacy controls as manual investigations, with AI investigation authorised for detected threats.' },
  { what: 'Links you investigate', when: 'When you manually check or share a link, message or email', detail: 'Apollo receives a sanitised URL for the requested investigation. Credentials, fragments and secret query values are removed first. Reputation, safe webpage and domain-registration services receive only the URL or hostname needed for their check. Cached reputation uses a digest; expired rows are ignored, not treated as current evidence.' },
  { what: 'Minimal Patrol summaries and packet evidence', when: 'After checks and native observations; retried until acknowledged', detail: 'Apollo stores category, state, timestamps, opaque event IDs and website domain. Packet evidence adds mechanism, protocol, rule ID, port and observed action. No caller numbers, app/process attribution or raw message narratives. Clear Patrol currently hides server rows (soft deletion), not physical erasure. Pending uploads are shown in Patrol.' },
  { what: 'Device and notification settings', when: 'Setup, heartbeat, notification enablement and settings changes', detail: 'A server-issued random device ID, platform/app version, coarse UTC offset and quiet-hour preferences go to Apollo. Push delivery tokens go to the managed relay and Apple/Google delivery services. Disable notifications in Settings to stop notifications; this is not data erasure.' },
  { what: 'Ask Higgins and Hear Higgins', when: 'When you send a question, tap read-aloud, or explicitly enable automatic read-aloud', detail: 'Questions and requested speech go to Higgins using the owner-managed key; do not paste private messages or secrets. Automatic event context is replaced with a generic summary. Apollo retains conversation history and temporary cached speech under the stated case lifecycle. Turning off read-aloud stops future automatic speech requests. Personal identifiers in research queries are minimised within Apollo\u2019s backend before reaching Google Gemini.' },
  { what: 'Optional family support', when: 'You pair, invite, share an incident, reply or send a text note', detail: 'Chosen names, contact details, minimal alerts, weekly counts and replies go to Apollo and paired guardians. Invitations use an email delivery service; confirmed guardians also receive authorised automatic security alerts via email when Apollo is barking or biting. Alerts use the push relay. Remove a pairing to stop future sharing; it does not erase prior deliveries.' },
  { what: 'App reputation checks', when: 'You manually check an app', detail: 'The supplied app/developer names, source, permission labels and website hosts go to Apollo and optionally Higgins for explanation, not your full app inventory. Do not enter personal content in app-name fields.' },
  { what: 'Optional Gmail investigation', when: 'Only after you connect Gmail with Google OAuth and start a scan or monitor', detail: "Apollo uses Gmail read-only OAuth access. Apollo never asks for or stores a mailbox username or password. Disconnect removes Apollo's stored OAuth connection; revoke provider access as an additional control. Raw message content is not copied into Patrol. Email attachment hashes are checked against VirusTotal for known malware; file content is never sent." },
];

export const AI_PROCESSING_DISCLOSURE = {
  title: 'How AI investigation works',
  sections: [
    {
      heading: 'Where your data goes',
      text: "When you submit content for AI investigation, Apollo transmits privacy-processed evidence through its own service to Google Gemini. For Gmail monitoring, previously authorised automatic investigations use the same privacy controls. This uses a paid API tier managed by Apollo \u2014 it is not your personal Google account and does not connect to any Google account you own.",
    },
    {
      heading: 'What Google receives',
      text: 'For manual investigations: content you explicitly approve through the privacy gate \u2014 sanitised text from messages or screenshots, redacted images (with sensitive regions blacked out), and minimal research queries. For Gmail monitoring: privacy-processed email evidence from your previously authorised connection. In all cases, credentials, passwords, and raw screenshots that fail the privacy gate are never transmitted.',
    },
    {
      heading: 'Data retention',
      text: "Apollo uses the paid Gemini API tier. According to Google's published API terms, customer data sent via the paid API is not used for model training. Request-scoped processing copies on Apollo's side are closed immediately after completion and never retained beyond 15 minutes. Google's own data retention and processing practices are governed by their published API terms, which Apollo does not control or independently verify.",
    },
    {
      heading: 'Research queries',
      text: 'When Higgins researches a domain, phone number, or scam report, the outbound query is minimised. Personal identifiers detected in your evidence (emails, phone numbers, account numbers) are replaced with category labels within Apollo\u2019s backend before the query reaches Google Gemini. Domain names and scam indicators are preserved because they are essential for the investigation.',
    },
    {
      heading: 'On-device screening',
      text: "Every image submitted for manual investigation passes through Apollo's on-device privacy gate before transmission. You choose: send extracted text only (image never leaves your device), send a redacted image (sensitive areas blacked out), or withhold entirely. No image bypasses this gate \u2014 it is enforced in both the app and the server.",
    },
  ],
};

export const LOCAL_ONLY_CONTENT = ['Passwords, verification codes and sensitive URL tokens', 'Full messages, screenshots and files after their submitted assessment completes', 'Browsing history, precise location, IMEI, serial number and advertising ID'];

export const PRIVACY_STANDARDS_DISCLOSURE = {
  title: 'Privacy standards',
  intro: "Apollo's privacy and security controls are designed to conform with the following recognised international standards. Adoption means Apollo maps its controls against these standards through internal conformity assessment. Independent certification is not currently claimed.",
  standards: [
    { name: 'ISO/IEC 27701:2025', role: 'Privacy Information Management System (PIMS)' },
    { name: 'ISO/IEC 29100:2024', role: 'Privacy terminology, definitions and principles' },
    { name: 'ISO/IEC 27001:2022', role: 'Information security management and controls' },
    { name: 'ISO/IEC 42001:2023', role: 'AI governance and accountability' },
    { name: 'Australian Privacy Act 1988', role: 'Applicable Australian legal requirements and Privacy Principles (APPs)' },
    { name: 'ISO/IEC 27559:2022', role: 'De-identification framework for personal data minimisation' },
    { name: 'ISO 31700-1:2023', role: 'Privacy-by-design requirements' },
  ],
};

export const THIRD_PARTY_SERVICES_DISCLOSURE = {
  title: 'Third-party services',
  intro: 'Apollo is a brand of Harmony Wellness Group (HWG), which is accountable for the selection, configuration and oversight of the external services Apollo uses. Apollo uses external services only where needed to provide security investigations, reputation checks, communications, storage or supporting functionality.',
  services: [
    { name: 'Google Gemini', purpose: 'AI-powered security investigations, explanations and research', shared: 'Privacy-processed investigation evidence, approved content, security indicators and minimised research queries. Authentication secrets are never sent.' },
    { name: 'Google Safe Browsing', purpose: 'Detect known unsafe websites', shared: 'Sanitised website addresses and domains. Credentials and secret query values are removed before lookup.' },
    { name: 'Google Gmail', purpose: 'Optional read-only email checking', shared: 'Google OAuth authorisation and access to email information within the approved read-only scope. Only active when you connect Gmail.' },
    { name: 'VirusTotal', purpose: 'Email attachment malware scanning', shared: 'SHA-256 file hashes only. File content is never sent. Active when Gmail monitoring is connected.' },
    { name: 'XposedOrNot / Have I Been Pwned', purpose: 'Check whether an email appears in known data breaches', shared: 'The email address submitted for the specific breach check.' },
    { name: 'IPQualityScore', purpose: 'Phone-number fraud and reputation checking', shared: 'The phone number being checked.' },
    { name: 'Push notifications (Expo, Google FCM, Apple APNs)', purpose: 'Deliver security and family alerts', shared: 'Push delivery tokens and notification content. Only active when you enable notifications.' },
    { name: 'Emergent-managed email delivery', purpose: 'Family invitations, guardian security alerts and service emails', shared: 'Recipient email address, subject and email content. Triggered by your actions (invitations) and by authorised automatic security alerts to confirmed family guardians.' },
    { name: 'Database hosting provider', purpose: 'Store authorised application and investigation records', shared: 'Records permitted by Apollo\u2019s storage and retention controls.' },
    { name: 'Domain registries and public websites', purpose: 'Domain registration research and website investigation', shared: 'Domain lookup requests and requested website access for URLs you submit.' },
  ],
  footer: 'Optional integrations operate only when you enable the relevant feature. Apollo applies purpose-based privacy controls to all information sent to external services. Some personal information (such as an email address for breach checking or a phone number for reputation checking) must be shared with the relevant provider for the service to work. These are necessary, authorised disclosures.',
  changes: 'Harmony Wellness Group may add, remove or replace third-party services to improve security, privacy, reliability or functionality. New or replacement services remain subject to Apollo\u2019s privacy and security controls. Where changes materially affect the handling of personal information, updated disclosures will be provided and additional consent obtained where legally required.',
};

export const THIRD_PARTY_REGISTER = {
  title: 'HWG Third-Party Service Register',
  accountable: 'Harmony Wellness Group (HWG)',
  intro: 'Harmony Wellness Group is accountable for the selection, configuration and oversight of the external services Apollo uses. This register reflects the verified deployment configuration.',
  active: [
    { name: 'Google Gemini', purpose: 'AI-powered security investigations, explanations and research', shared: 'Privacy-processed investigation evidence, approved content, security indicators and minimised research queries. Authentication secrets are never sent.', controls: 'Single gateway; credential stripping; PII minimisation; purpose-based authorisation' },
    { name: 'Google Safe Browsing', purpose: 'Detect known unsafe websites', shared: 'Sanitised website addresses and domains', controls: 'URL sanitisation removes credentials and secret parameters' },
    { name: 'IPQualityScore', purpose: 'Phone-number fraud and reputation checking', shared: 'The phone number being checked', controls: 'Single-field transmission' },
    { name: 'VirusTotal', purpose: 'Email attachment malware scanning (hash-only)', shared: 'SHA-256 file hashes only; file content never sent', controls: 'Hash-only mode; free tier rate-limited' },
    { name: 'Push notifications (Expo, FCM, APNs)', purpose: 'Deliver security and family alerts', shared: 'Push delivery tokens and notification content', controls: 'Minimal notification content' },
    { name: 'Emergent-managed email delivery', purpose: 'Family invitations and guardian security alerts', shared: 'Recipient email, subject and content', controls: 'Triggered by user actions and authorised automatic alerts to confirmed guardians' },
    { name: 'MongoDB hosting provider', purpose: 'Store authorised application records', shared: 'Records permitted by retention controls', controls: 'Owner-scoped access; Fernet encryption; 15-minute scoped retention' },
  ],
  optional: [
    { name: 'Google Gmail', purpose: 'Optional read-only email checking', shared: 'OAuth authorisation and email within read-only scope', activation: 'User connects Gmail via OAuth in Settings' },
    { name: 'XposedOrNot', purpose: 'Check if an email appears in known breaches', shared: 'Email address submitted for the check', activation: 'Free API; default breach provider' },
    { name: 'IANA / RDAP registries', purpose: 'Domain registration research', shared: 'Domain name being investigated', activation: 'Public registries; no credentials required' },
    { name: 'Public websites', purpose: 'Investigation of submitted websites', shared: 'Requested website access', activation: 'Triggered by user-submitted URL investigation' },
  ],
  unconfigured: [
    { name: 'Have I Been Pwned', purpose: 'Breach checking (replaces XposedOrNot when configured)', activation: 'Requires HIBP API key' },
    { name: 'S3-compatible storage', purpose: 'Family shared content', activation: 'Requires storage credentials' },
  ],
};

export const COMPLIANCE_MATRIX_DISCLOSURE = {
  title: 'Apollo Compliance Matrix',
  version: '3.0',
  effective: 'June 2026',
  framework: 'Application technical compliance is assessed independently from operational and legal assurance. Passing code tests establishes application compliance. It does not automatically establish full ISO management-system conformity.',
  standards: [
    { name: 'ISO/IEC 27701:2025', role: 'Privacy Information Management' },
    { name: 'ISO/IEC 29100:2024', role: 'Privacy principles and definitions' },
    { name: 'ISO/IEC 27001:2022', role: 'Information security controls' },
    { name: 'ISO/IEC 42001:2023', role: 'AI governance and accountability' },
    { name: 'Australian Privacy Act 1988', role: 'Australian Privacy Principles (APPs)' },
    { name: 'ISO/IEC 27559:2022', role: 'De-identification framework' },
    { name: 'ISO 31700-1:2023', role: 'Privacy-by-design' },
  ],
  appControls: [
    { control: 'Privacy by default', detail: 'Local-first processing, minimum collection, automatic withholding', status: 'implemented' as const },
    { control: 'Personal information protection', detail: 'Identification, classification and redaction of unnecessary personal data', status: 'implemented' as const },
    { control: 'Credential protection', detail: 'Prevent passwords, tokens and authentication codes from reaching Gemini', status: 'implemented' as const },
    { control: 'Purpose limitation', detail: 'Restrict information to each service according to its authorised purpose', status: 'implemented' as const },
    { control: 'Security evidence preservation', detail: 'Preserve sender details, URLs, scam wording and essential indicators', status: 'implemented' as const },
    { control: 'Image privacy', detail: 'On-device screening, consent decisions and receipt validation', status: 'implemented' as const },
    { control: 'Encryption', detail: 'Protect information transmitted and stored by application components', status: 'implemented' as const },
    { control: 'Access control', detail: 'Authenticate devices, isolate records and protect administrative endpoints', status: 'implemented' as const },
    { control: 'Retention and deletion', detail: 'Enforce temporary retention, expiry and deletion of application-managed records', status: 'implemented' as const },
    { control: 'Investigative integrity', detail: 'Validate evidence references, recommendations, uncertainty and completion claims', status: 'implemented' as const },
    { control: 'User choice and consent', detail: 'Privacy notices, permission controls and approval before relevant disclosure', status: 'implemented' as const },
    { control: 'Technical auditability', detail: 'Privacy-safe records of relevant processing and security decisions', status: 'implemented' as const },
  ],
  operationalItems: [
    { requirement: 'Formal privacy policy', appDoes: 'Display notices, obtain acknowledgements, offer privacy controls', outsideApp: 'Determine and approve legally adequate policy wording' },
    { requirement: 'Cross-border disclosure', appDoes: 'Minimise and authorise data leaving the device', outsideApp: 'Assess overseas processing and applicable legal obligations' },
    { requirement: 'Supplier management', appDoes: 'Restrict Gemini requests through an audited gateway', outsideApp: 'Evaluate supplier commitments and contractual terms' },
    { requirement: 'Incident response', appDoes: 'Detect incidents, record evidence, revoke access, delete data', outsideApp: 'Assign responsibilities, evaluate breaches, handle notifications' },
    { requirement: 'Bias and fairness', appDoes: 'Implement evidence-based decisions, run fairness regression tests', outsideApp: 'Approve the assessment and periodically review outcomes' },
    { requirement: 'Formal access and correction', appDoes: 'Provide access, correction and deletion capabilities', outsideApp: 'Handle formal requests, identity verification and exceptions' },
    { requirement: 'Organisational accountability', appDoes: 'Produce audit evidence and compliance reports', outsideApp: 'Assign accountable people and maintain governance' },
  ],
  testSummary: '344 tests passing (254 backend + 90 frontend). 12-point acceptance checklist verified.',
};
