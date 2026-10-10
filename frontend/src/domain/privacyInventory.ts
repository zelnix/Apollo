// Single maintained processing inventory; screen + Settings summaries must refer here.
export const PRIVACY_FLOWS = [
  { what: 'Purpose-limited security assessments', when: 'When you submit a message, email, screenshot, account alert, phone number or link', detail: 'Apollo combines on-device detection with Higgins context and supported reputation sources. Raw submitted content is not kept in Patrol, logs or analytics. Request-scoped copies close immediately after completion or failure and never later than 15 minutes.' },
  { what: 'Optional ongoing access', when: 'Only after you enable notification access or connect Gmail with OAuth', detail: 'Android notification checks and Gmail OAuth are opt-in. Disconnect or disable access to stop future checks. Apollo never asks for or stores a mailbox username or password.' },
  { what: 'Links you investigate', when: 'When you manually check or share a link, message or email', detail: 'Apollo receives a sanitised URL for the requested investigation. Credentials, fragments and secret query values are removed first. Reputation, safe webpage and domain-registration services receive only the URL or hostname needed for their check. Cached reputation uses a digest; expired rows are ignored, not treated as current evidence.' },
  { what: 'Minimal Patrol summaries and packet evidence', when: 'After checks and native observations; retried until acknowledged', detail: 'Apollo stores category, state, timestamps, opaque event IDs and website domain. Packet evidence adds mechanism, protocol, rule ID, port and observed action. No caller numbers, app/process attribution or raw message narratives. Clear Patrol currently hides server rows (soft deletion), not physical erasure. Pending uploads are shown in Patrol.' },
  { what: 'Device and notification settings', when: 'Setup, heartbeat, notification enablement and settings changes', detail: 'A server-issued random device ID, platform/app version, coarse UTC offset and quiet-hour preferences go to Apollo. Push delivery tokens go to the managed relay and Apple/Google delivery services. Disable notifications in Settings to stop notifications; this is not data erasure.' },
  { what: 'Ask Higgins and Hear Higgins', when: 'When you send a question, tap read-aloud, or explicitly enable automatic read-aloud', detail: 'Questions and requested speech go to Higgins using the owner-managed key; do not paste private messages or secrets. Automatic event context is replaced with a generic summary. Apollo retains conversation history and temporary cached speech under the stated case lifecycle. Turning off read-aloud stops future automatic speech requests.' },
  { what: 'Optional family support', when: 'You pair, invite, share an incident, reply or explicitly send a note', detail: 'Chosen names, contact details, minimal alerts, weekly counts and replies go to Apollo and paired guardians. Invitations use an email delivery service; alerts use the push relay. Voice notes you explicitly send use owner-managed object storage and Higgins captioning, with retention and unlink cleanup. Remove a pairing to stop future sharing; it does not erase prior deliveries.' },
  { what: 'App reputation checks', when: 'You manually check an app', detail: 'The supplied app/developer names, source, permission labels and website hosts go to Apollo and optionally Higgins for explanation, not your full app inventory. Do not enter personal content in app-name fields.' },
  { what: 'Optional Gmail investigation', when: 'Only after you connect Gmail with Google OAuth and start a scan or monitor', detail: "Apollo uses Gmail read-only OAuth access. Apollo never asks for or stores a mailbox username or password. Disconnect removes Apollo's stored OAuth connection; revoke provider access as an additional control. Raw message content is not copied into Patrol." },
];

export const AI_PROCESSING_DISCLOSURE = {
  title: 'How AI investigation works',
  sections: [
    {
      heading: 'Where your data goes',
      text: "When you approve content for AI investigation, Apollo transmits it through its own service to Google Gemini. This uses a paid API tier managed by Apollo \u2014 it is not your personal Google account and does not connect to any Google account you own.",
    },
    {
      heading: 'What Google receives',
      text: 'Only the content you explicitly approve through the privacy gate: sanitised text from messages or screenshots, redacted images (with sensitive regions blacked out), and minimal research queries. Credentials, passwords, and raw screenshots that fail the privacy gate are never transmitted.',
    },
    {
      heading: 'Data retention',
      text: "Under the paid Gemini API tier, Google states that customer data sent via the API is not used to train models. Request-scoped processing copies on Apollo's side are closed immediately after completion and never retained beyond 15 minutes. Google's own API data retention follows their published API terms; Apollo does not control the provider's retention schedule.",
    },
    {
      heading: 'Research queries',
      text: 'When Higgins researches a domain, phone number, or scam report, the outbound query is minimised. Personal identifiers detected in your evidence (emails, phone numbers, account numbers) are replaced with category labels before leaving the device. Domain names and scam indicators are preserved because they are essential for the investigation.',
    },
    {
      heading: 'On-device screening',
      text: "Every image passes through Apollo's on-device privacy gate before transmission. You choose: send extracted text only (image never leaves your device), send a redacted image (sensitive areas blacked out), or withhold entirely. No image bypasses this gate \u2014 it is enforced in both the app and the server.",
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
