// Simulated inbox for the PREVIEW ONLY.
//
// These are sample emails whose sole purpose is to provide INPUT to Apollo's real email check when
// the preview has no connected mailbox. There is no preview investigation path, no mock Triage
// result, no mock Magnum DI result and no predetermined verdict: every selected email goes through
// exactly the same `run()` flow as a real email, and Apollo's own deterministic Triage — and, only
// where Triage escalates, the real Magnum DI investigation — decides the outcome.
//
// `probes` describes WHAT THE EMAIL CONTAINS, never what Apollo will conclude about it.

export interface SimulatedEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
  /** What this sample contains, so the content being exercised is clear. Never a verdict. */
  probes: string;
}

export const SIMULATED_EMAILS: SimulatedEmail[] = [
  {
    id: "sim-receipt",
    from: "receipts@coles.com.au",
    subject: "Your Coles receipt for 14 June",
    body: `Hi Margaret,

Thanks for shopping with us. Your receipt for Tuesday 14 June is attached to your account.

Total: $64.20
Store: Coles Brighton
Flybuys points earned: 64

No action is needed. You can view past receipts any time by signing in from the Coles app you already have.

Coles Supermarkets Australia`,
    probes: "An ordinary receipt: no links, no requests, no urgency.",
  },
  {
    id: "sim-newsletter",
    from: "news@abc.net.au",
    subject: "ABC News: your Thursday briefing",
    body: `Good morning,

Today's top stories from ABC News.

- Parliament debates the new energy bill
- Heavy rain forecast for the south-east
- Socceroos name their squad

Read the full briefing: https://www.abc.net.au/news/briefing

You are receiving this because you subscribed. Unsubscribe any time from the link at the bottom of this email.`,
    probes: "A normal newsletter with a link to a well-known Australian domain.",
  },
  {
    id: "sim-bank-lookalike",
    from: "security@commbank-alerts.co",
    subject: "URGENT: unusual sign-in detected — verify within 24 hours",
    body: `Dear Customer,

We detected an unusual sign-in attempt on your NetBank account from a new device. For your protection your account has been limited.

You must confirm your identity within 24 hours or your account will be permanently suspended.

Verify now: http://commbank-secure-verify.co/netbank/login

Please have your client number and password ready to complete verification.

CommBank Security Team`,
    probes: "Bank impersonation: lookalike sender domain, 24-hour deadline, a login link and a request for a client number and password.",
  },
  {
    id: "sim-mygov-authority",
    from: "no-reply@mygov-refunds.net",
    subject: "ATO notice: outstanding tax debt — immediate payment required",
    body: `OFFICIAL NOTICE — AUSTRALIAN TAXATION OFFICE

Our records show an outstanding debt of $1,842.60 against your tax file number.

A warrant for arrest may be issued if this amount is not settled today. To stop legal action, pay immediately using the voucher codes supplied by our officer on the phone, or reply to this email with your TFN and bank details so we can arrange a transfer to a protected holding account.

Reference: ATO-4471-AU
myGov | Australian Taxation Office`,
    probes: "Government impersonation with an arrest threat, voucher payment, a request for a tax file number and a transfer to a 'protected' account.",
  },
  {
    id: "sim-gift-cards",
    from: "d.whitfield.ceo@gmail.com",
    subject: "Quick favour - are you at your desk?",
    body: `Hi,

I'm stuck in back-to-back meetings and can't take calls. I need you to organise a client gift for me discreetly.

Can you purchase 4 x $250 Apple gift cards from the shop near the office? Scratch the backs and email me photos of the codes as soon as you have them. I'll reimburse you with expenses on Friday.

Please keep this between us until the client is told.

Thanks,
David
Chief Executive Officer (sent from my phone)`,
    probes: "Executive impersonation from a free webmail address requesting gift-card codes and secrecy.",
  },
  {
    id: "sim-otp-request",
    from: "support@auspost-parcels.help",
    subject: "Action needed: confirm the 6-digit code we just sent you",
    body: `Hello,

Your parcel AP4471882AU could not be delivered because the address could not be verified.

We have just sent a 6-digit security code to your mobile. Reply to this email with that code so our team can release your parcel for redelivery.

If you do not reply with the code within 48 hours the parcel will be returned to sender.

Australia Post Customer Care`,
    probes: "Delivery pretext asking for the one-time code sent to the recipient's phone.",
  },
  {
    id: "sim-remote-access",
    from: "helpdesk@ms-support-team.online",
    subject: "Your computer has sent us 1,284 virus reports",
    body: `Microsoft Support Notification

Our monitoring centre has received 1,284 error and virus reports from your Windows licence in the past 24 hours.

An engineer is standing by. To begin the repair, download and install our support tool, then give the engineer the connection ID shown on screen so he can take control of your computer and remove the infection.

Download the support tool: http://ms-support-team.online/fix/AnyRemoteSetup.exe

Do not switch the computer off. Microsoft Certified Support`,
    probes: "Tech-support pretext asking for software installation and remote control of the computer.",
  },
  {
    id: "sim-extortion",
    from: "no.reply.9183@protonmail.com",
    subject: "I have your password and your recordings",
    body: `I will get straight to it.

I placed malware on an adult site you visited and recorded you through your camera. I also have your contact list.

Pay $1,350 in Bitcoin to the wallet below within 48 hours and I delete everything. If you do not pay, I send the recording to every contact you have.

Wallet: bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh

Do not reply. The timer has started.`,
    probes: "Extortion with a cryptocurrency demand and a 48-hour deadline.",
  },
  {
    id: "sim-advance-fee",
    from: "barrister.k.mensah@legal-chambers-gh.org",
    subject: "Confidential: unclaimed estate of a deceased client",
    body: `Dear Sir/Madam,

I am the appointed barrister for a client who died intestate leaving US$8.4 million unclaimed. You share a surname with the deceased and may be presented as next of kin.

The transfer requires only the payment of a modest estate release fee of US$2,850 to the probate registry, after which the funds will be split 60/40 in your favour.

Reply with your full name, address and bank details to begin the paperwork. Absolute confidentiality is required.

Yours faithfully,
Barrister K. Mensah`,
    probes: "Advance-fee pretext: a large inheritance released only after an up-front fee, requesting bank details.",
  },
  {
    id: "sim-unknown-host",
    from: "bookings@tr-lodge-stay.xyz",
    subject: "Your booking confirmation #88213",
    body: `Thank you for your booking.

Check-in: 22 June, 2:00 PM
Reference: 88213

Manage your booking: https://portal.tr-lodge-stay.xyz/manage/88213

If you did not make this booking you can ignore this email.`,
    probes: "An otherwise plain booking email whose only link is an unfamiliar domain that reputation services may not have a record of.",
  },
];
