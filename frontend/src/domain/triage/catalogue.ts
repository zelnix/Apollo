// GENERATED from backend/content/triage_catalogue.json — the single source of truth for Apollo's
// deterministic Triage rules. Do not hand-edit: change the backend catalogue and re-copy.
// tests/triage.test.ts fails if this drifts from the backend file.

const CATALOGUE = {
  "version": 3,
  "updated": "2026-06",
  "outcomes": [
    "NO_THREAT_IDENTIFIED",
    "POSSIBLE_THREAT_IDENTIFIED",
    "LIMITED_UNABLE_TO_DETERMINE"
  ],
  "completeness": {
    "availableChecksLabel": "No threat found by available checks",
    "checks": {
      "reputation": "A reputation check didn't complete",
      "final_destination": "Apollo couldn't verify where this link finally leads",
      "number_reputation": "The phone number's reputation check didn't complete",
      "sender_authentication": "ApolloSG couldn't read the email's sender authentication (SPF, DKIM and DMARC)"
    },
    "failures": {
      "timeout": "it timed out",
      "offline": "there was no connection",
      "provider_unavailable": "the service couldn't be reached",
      "server_error": "the service had an error",
      "rate_limited": "the service was busy",
      "quota_exhausted": "its lookup allowance is used up for now",
      "auth_failure": "the lookup wasn't authorised",
      "forbidden": "the lookup wasn't allowed",
      "rejected": "the service couldn't accept it",
      "malformed": "the answer couldn't be read",
      "not_configured": "it isn't set up here",
      "no_data": "the service had no information",
      "nonexistent_domain": "the website's address doesn't exist",
      "connection_failure": "the website couldn't be reached",
      "unsafe_destination": "it pointed somewhere Apollo won't connect to",
      "redirect_limit": "it redirected too many times",
      "unparseable_link": "the link couldn't be read",
      "redirect_failure": "the redirect couldn't be followed",
      "original_not_provided": "ApolloSG received a copy of the email without its full headers",
      "not_recorded": "the receiving mail server didn't record those results in the email"
    },
    "stale": "the live lookup failed ({failure}), so Apollo used the result of its last check"
  },
  "evidenceProfiles": {
    "version": 1,
    "classifiedBy": "Higgins Triage",
    "statuses": {
      "verified": "Verified by ApolloSG",
      "recorded": "Recorded by the source, not verified by ApolloSG",
      "observed": "Observed, not verified",
      "unavailable": "Couldn't be verified"
    },
    "signalsTitle": "Investigation signals — not proof of fraud",
    "caution": "Each of these is one signal to weigh in context. On its own, none of them makes something safe or fraudulent.",
    "authCaution": "Passing SPF, DKIM or DMARC confirms only which domain sent the email. It never makes an email safe.",
    "types": {
      "email": {
        "label": "Email",
        "levels": {
          "L1": {
            "rank": 1,
            "label": "L1 — Visual/Text",
            "received": "a screenshot or pasted text of the email",
            "basis": "ApolloSG only received a screenshot or pasted text, so technical sender authentication could not be independently verified."
          },
          "L2": {
            "rank": 2,
            "label": "L2 — Shared Email",
            "received": "the email shared from another app, with the details that app passed on",
            "basis": "ApolloSG received the email shared from another app, but not its full headers, so technical sender authentication could not be independently verified."
          },
          "L3": {
            "rank": 3,
            "label": "L3 — Original Message",
            "received": "the original email with its full headers",
            "basis": "ApolloSG examined the original email and full headers."
          },
          "L4": {
            "rank": 4,
            "label": "L4 — Provider-Verified Source",
            "received": "the original email, retrieved by ApolloSG itself through your connected email account",
            "basis": "ApolloSG retrieved the original email itself through your connected email account and examined it with its full headers."
          }
        },
        "capabilities": {
          "original_message": "Original message",
          "provider_provenance": "Provider provenance",
          "full_headers": "Full headers",
          "sender_address": "Sender address",
          "reply_to": "Reply-To",
          "return_path": "Return-Path",
          "message_id": "Message-ID",
          "received_chain": "Routing (Received chain)",
          "spf": "SPF",
          "dkim": "DKIM",
          "dmarc": "DMARC",
          "arc": "ARC",
          "mime": "MIME structure",
          "attachments": "Attachments",
          "links": "Links and domains"
        },
        "via": {
          "pasted": "Pasted text",
          "screenshot": "Screenshot",
          "shared": "Shared from another app",
          "eml_file": "Original email file (.eml)",
          "raw_source": "Original message source, pasted",
          "connected_mailbox": "Retrieved from your connected email account",
          "simulated": "Preview sample email"
        },
        "authRecorded": "Recorded by {server}, the mail server that received this email. ApolloSG reports this result as recorded and didn't re-check it.",
        "authUnconfirmed": "Recorded in the email by {server}. ApolloSG couldn't match that to the servers that delivered it, and didn't re-check it.",
        "authNotRecorded": "The receiving mail server didn't record a result for this.",
        "authNeedsOriginal": "Needs the original email with its full headers.",
        "upgrade": "Evidence upgraded from {from} to {to}. Higgins Triage re-checked the email with the new evidence; the earlier result is kept in the case history.",
        "upgradeMismatch": "That original doesn't match the email you checked, so ApolloSG checked it as a separate email.",
        "signals": {
          "reply_to_differs": "Replies would go to {replyTo}, not the sender's domain {from}.",
          "return_path_differs": "Bounced mail goes to {returnPath}, a different domain from the sender {from}. Mailing services often do this.",
          "spf_failed": "The receiving server recorded SPF as {result}: the server that sent it wasn't authorised to send for {domain}.",
          "dkim_failed": "The receiving server recorded DKIM as {result}: the email's signature didn't check out.",
          "dmarc_failed": "The receiving server recorded DMARC as {result}: the email didn't prove it really came from {from}.",
          "dkim_unaligned": "The DKIM signature that passed belongs to {domain}, not the sender's domain {from}.",
          "no_auth_recorded": "The receiving mail server didn't record any SPF, DKIM or DMARC results in this email.",
          "recorder_unconfirmed": "The authentication results were recorded by {server}, which ApolloSG couldn't match to the servers that delivered this email.",
          "display_name_address": "The sender's display name shows the address {shown}, but the email was sent from {from}.",
          "message_id_differs": "Its Message-ID was created at {domain}, not at the sender's domain {from}."
        }
      },
      "link": {
        "label": "Link or website",
        "levels": {
          "as_given": {
            "rank": 1,
            "label": "Link as given",
            "received": "the link itself",
            "basis": "ApolloSG only had the link itself — none of its lookups answered, so nothing about the site could be verified."
          },
          "checked": {
            "rank": 2,
            "label": "Link checked",
            "received": "the link, checked against ApolloSG's lookups",
            "basis": "ApolloSG checked the link with its own lookups."
          },
          "followed": {
            "rank": 3,
            "label": "Destination followed",
            "received": "the link, followed by ApolloSG to where it really leads",
            "basis": "ApolloSG followed the link to its final destination and checked it there."
          },
          "seen_by_site_gate": {
            "rank": 2,
            "label": "Connection seen by Site Gate",
            "received": "a connection this phone tried to make, seen by Site Gate",
            "basis": "ApolloSG's Site Gate saw this phone try to connect to the site and stopped it on this device. It saw where the connection was going, not the page itself."
          }
        },
        "capabilities": {
          "original_url": "Original URL",
          "redirect_chain": "Redirect chain",
          "final_destination": "Final destination",
          "domain_registration": "Domain registration",
          "reputation": "Reputation",
          "tls_certificate": "TLS certificate",
          "hosting": "Hosting and DNS",
          "connection": "Connection attempt",
          "block": "Block on this device"
        },
        "via": {
          "pasted": "Link you entered",
          "shared": "Shared from another app",
          "qr": "QR code",
          "message": "Link from a message or email",
          "recheck": "Re-check from the case",
          "site_gate": "Site Gate on this phone"
        },
        "notes": {
          "noLookup": "ApolloSG's lookups didn't answer, so this couldn't be checked.",
          "notFollowed": "ApolloSG couldn't follow the link to where it finally leads.",
          "followedBy": "Followed by ApolloSG's server. It never opens the page on your phone.",
          "registry": "Recorded by the domain's registry, not verified by ApolloSG.",
          "registryNoAnswer": "The domain's registry didn't answer.",
          "reputation": "Each list says only what it already knows. A clean answer isn't proof that a site is safe.",
          "tls": "ApolloSG doesn't inspect the site's security certificate.",
          "hosting": "ApolloSG doesn't look up where the site is hosted.",
          "siteGateOnly": "Site Gate sees the site's name, not the full link or the page.",
          "connectionSeen": "Seen by ApolloSG's Site Gate on this phone.",
          "blockConfirmed": "Blocked on this phone, confirmed by the operating system.",
          "blockFlow": "The operating system reported the connection as stopped."
        },
        "upgrade": "Evidence upgraded from {from} to {to}. Higgins Triage re-checked the link with it; the earlier result is kept in the case history.",
        "recheck": "Higgins Triage re-checked the link with fresh lookups. The earlier result is kept in the case history.",
        "recheckWeaker": "The re-check couldn't get as far as the earlier check ({level}), so this case keeps its earlier result.",
        "signals": {
          "redirects_elsewhere": "The link redirects to {final}, a different site from {host}.",
          "newly_registered": "The domain {domain} was registered {age}.",
          "destination_unverified": "ApolloSG couldn't follow the link to where it finally leads, so the page it opens wasn't checked."
        }
      },
      "message": {
        "label": "Message",
        "levels": {
          "screenshot": {
            "rank": 1,
            "label": "Screenshot",
            "received": "a screenshot of the message",
            "basis": "ApolloSG only received a screenshot, so who really sent it and when could not be verified."
          },
          "pasted": {
            "rank": 1,
            "label": "Pasted text",
            "received": "the message text you pasted",
            "basis": "ApolloSG only received the pasted text, so who really sent it and when could not be verified."
          },
          "shared": {
            "rank": 2,
            "label": "Shared from an app",
            "received": "the message shared from another app",
            "basis": "ApolloSG received the message shared from another app; the app passed on its text, not proof of who sent it."
          },
          "captured": {
            "rank": 3,
            "label": "Captured from the notification",
            "received": "the message as your phone's notification showed it",
            "basis": "ApolloSG read the message from your phone's notification itself, so it knows which app posted it and when — not who really sent it."
          }
        },
        "capabilities": {
          "sender": "Sender",
          "timestamp": "Time received",
          "source": "How ApolloSG got it",
          "platform_provenance": "Platform provenance",
          "links": "Links",
          "numbers": "Phone numbers",
          "attachments": "Attachments"
        }
      },
      "call": {
        "label": "Call",
        "levels": {
          "number_only": {
            "rank": 1,
            "label": "Number only",
            "received": "the phone number",
            "basis": "ApolloSG only had the number; its reputation lookup didn't answer, so nothing about it could be verified."
          },
          "number_checked": {
            "rank": 2,
            "label": "Number checked",
            "received": "the phone number, checked with a number-reputation lookup",
            "basis": "ApolloSG checked the number's reputation. The number shown for a call can be faked, and ApolloSG can't yet read the phone network's own caller verification."
          },
          "screened_call": {
            "rank": 3,
            "label": "Call screened by ApolloSG",
            "received": "the call itself, seen by ApolloSG's call screening",
            "basis": "ApolloSG's call screening saw this call arrive. The number shown can still be faked, and ApolloSG can't yet read the phone network's own caller verification."
          }
        },
        "capabilities": {
          "number": "Number",
          "caller_id": "Caller ID",
          "timestamp": "Time of the call",
          "screening_result": "Screening result",
          "carrier": "Carrier and line type",
          "reputation": "Reputation",
          "spoofing_indicators": "Spoofing indicators"
        }
      },
      "file": {
        "label": "File or document",
        "levels": {
          "name_only": {
            "rank": 1,
            "label": "File name only",
            "received": "the file's name and size",
            "basis": "ApolloSG couldn't read the file's contents, so it could only go by the name and size."
          },
          "contents_read": {
            "rank": 2,
            "label": "Contents read",
            "received": "the file, read on your phone",
            "basis": "ApolloSG read the start of the file on your phone to find what it really is."
          },
          "fingerprinted": {
            "rank": 3,
            "label": "Contents read and fingerprinted",
            "received": "the whole file, read and fingerprinted on your phone",
            "basis": "ApolloSG read the file on your phone, found what it really is and fingerprinted it (SHA-256)."
          }
        },
        "capabilities": {
          "file_name": "File name",
          "declared_type": "Declared type",
          "true_type": "True file type",
          "sha256": "SHA-256 fingerprint",
          "metadata": "Document metadata",
          "signature": "Signatures and certificates",
          "macros": "Macros",
          "embedded_links": "Embedded links and scripts",
          "threat_indicators": "Threat indicators"
        }
      },
      "image": {
        "label": "Image",
        "levels": {
          "image": {
            "rank": 1,
            "label": "Image",
            "received": "the image",
            "basis": "ApolloSG read the picture on your phone. A picture shows what was on screen, not where it came from."
          }
        },
        "capabilities": {
          "image_content": "Image content",
          "metadata": "Image metadata",
          "source": "Where it came from",
          "embedded_identifiers": "Links, numbers and codes in it"
        }
      },
      "qr": {
        "label": "QR code",
        "levels": {
          "decoded": {
            "rank": 2,
            "label": "QR payload decoded",
            "received": "the QR code, decoded by ApolloSG",
            "basis": "ApolloSG decoded the QR code itself, so it knows exactly what the code contains — not who put it there."
          }
        },
        "capabilities": {
          "payload": "QR payload",
          "url": "URL in the code",
          "identifiers": "Other identifiers"
        }
      },
      "app": {
        "label": "App",
        "levels": {
          "described": {
            "rank": 1,
            "label": "Described by you",
            "received": "the app details you entered",
            "basis": "ApolloSG only had the details you entered, so the app's real identity, source and permissions could not be verified."
          },
          "read_from_device": {
            "rank": 2,
            "label": "Read from this device",
            "received": "the installed app's details, read from this phone",
            "basis": "ApolloSG read the installed app's details from this phone. Its signing information isn't available to ApolloSG yet."
          }
        },
        "capabilities": {
          "app_name": "App name",
          "package_id": "Package / bundle ID",
          "developer": "Publisher / developer",
          "install_source": "Install source",
          "permissions": "Permissions",
          "version": "Version",
          "signing": "Signing information",
          "store_security": "Store and OS security information"
        }
      }
    }
  },
  "coverageGapCodes": [
    {
      "code": "PLATFORM_CAPABILITY_UNAVAILABLE",
      "recoverable": false,
      "plain": "This device doesn't make that information available to ApolloSG."
    },
    {
      "code": "PERMISSION_UNAVAILABLE",
      "recoverable": true,
      "plain": "ApolloSG needs a permission before it can complete this check."
    },
    {
      "code": "INTELLIGENCE_PROVIDER_UNAVAILABLE",
      "recoverable": true,
      "plain": "A reputation service didn't answer in time."
    },
    {
      "code": "NETWORK_CHECK_FAILED",
      "recoverable": true,
      "plain": "ApolloSG couldn't reach the network to complete this check."
    },
    {
      "code": "CONTENT_NOT_ACCESSIBLE",
      "recoverable": true,
      "plain": "The content couldn't be opened for inspection."
    },
    {
      "code": "UNSUPPORTED_FILE_TYPE",
      "recoverable": false,
      "plain": "Apollo can't inspect this kind of file."
    },
    {
      "code": "ENCRYPTED_CONTENT",
      "recoverable": false,
      "plain": "The contents are encrypted, so Apollo couldn't inspect them."
    },
    {
      "code": "EMAIL_HEADERS_UNAVAILABLE",
      "recoverable": false,
      "plain": "The technical sender information wasn't available."
    },
    {
      "code": "BROWSER_VISIBILITY_UNAVAILABLE",
      "recoverable": false,
      "plain": "Apollo can't see inside the browser session on this device."
    },
    {
      "code": "INSUFFICIENT_EVIDENCE",
      "recoverable": false,
      "plain": "There wasn't enough evidence to decide either way."
    },
    {
      "code": "DETERMINISTIC_CHECK_ERROR",
      "recoverable": true,
      "plain": "A check failed while running and didn't recover."
    }
  ],
  "retryPolicy": {
    "attempts": 3,
    "transientOnly": true,
    "appliesTo": [
      "INTELLIGENCE_PROVIDER_UNAVAILABLE",
      "NETWORK_CHECK_FAILED",
      "CONTENT_NOT_ACCESSIBLE",
      "DETERMINISTIC_CHECK_ERROR"
    ]
  },
  "rules": [
    {
      "id": "LINK-01",
      "category": "link",
      "title": "Authoritative reputation reports the destination as malicious",
      "evidence": [
        "reputation"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "LINK-02",
      "category": "link",
      "title": "An observed redirect destination is confirmed malicious",
      "evidence": [
        "redirect",
        "reputation"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "LINK-03",
      "category": "link",
      "title": "Local URL engine reaches malicious through deception-gated rules",
      "evidence": [
        "local_level",
        "local_signals"
      ]
    },
    {
      "id": "LINK-04",
      "category": "link",
      "title": "Known deterministic threat indicator match",
      "evidence": [
        "indicator_match"
      ]
    },
    {
      "id": "LINK-05",
      "category": "link",
      "title": "Brand-lookalike domain with credential, login, payment or account interaction",
      "evidence": [
        "local_signals",
        "credential_interaction"
      ]
    },
    {
      "id": "LINK-06",
      "category": "link",
      "title": "Credentials embedded in the URL",
      "evidence": [
        "credentials_in_url"
      ]
    },
    {
      "id": "LINK-07",
      "category": "link",
      "title": "Credential lure with an unrelated or deceptive destination",
      "evidence": [
        "credential_interaction",
        "brand_mismatch"
      ]
    },
    {
      "id": "LINK-08",
      "category": "link",
      "title": "Displayed link materially differs from the actual destination",
      "evidence": [
        "displayed_host",
        "actual_host"
      ]
    },
    {
      "id": "LINK-09",
      "category": "link",
      "title": "Brand presented in the link or path while the destination is unrelated, with a sensitive action",
      "evidence": [
        "local_signals",
        "credential_interaction"
      ]
    },
    {
      "id": "LINK-10",
      "category": "link",
      "title": "Newly registered domain with a credential, payment, security-code or identity form",
      "evidence": [
        "domain_age",
        "credential_interaction"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "LINK-11",
      "category": "link",
      "title": "Multiple URL-risk indicators reach the suspicious threshold and intelligence cannot resolve them",
      "evidence": [
        "local_level",
        "reputation"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "LINK-12",
      "category": "link",
      "title": "Suspicious URL evidence correlates with another suspicious event",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "QR-01",
      "category": "link",
      "title": "QR code contains a URL — the destination is triaged as a link",
      "evidence": [
        "qr_payload"
      ]
    },
    {
      "id": "QR-02",
      "category": "link",
      "title": "QR destination with brand or domain deception",
      "evidence": [
        "qr_payload",
        "brand_mismatch"
      ]
    },
    {
      "id": "QR-03",
      "category": "link",
      "title": "QR destination with a credential or payment lure and a suspicious, unrated or newly registered destination",
      "evidence": [
        "qr_payload",
        "credential_interaction",
        "domain_age"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "DATA-01",
      "category": "link",
      "title": "data: or blob: content collecting credentials in a deceptive brand context",
      "evidence": [
        "scheme",
        "credential_interaction"
      ],
      "platformDependent": true,
      "gapCode": "BROWSER_VISIBILITY_UNAVAILABLE"
    },
    {
      "id": "BITM-01",
      "category": "link",
      "title": "Sensitive credential interaction with observable real-time relay and an inconsistent destination",
      "evidence": [
        "credential_interaction",
        "realtime_relay",
        "destination_consistency",
        "deception_evidence"
      ],
      "platformDependent": true,
      "notApplicableWithout": "browser_observation"
    },
    {
      "id": "BITM-02",
      "category": "link",
      "title": "Brand authentication presented through an unauthorised origin with relay or strong deception",
      "evidence": [
        "auth_origin",
        "realtime_relay",
        "deception_evidence"
      ],
      "platformDependent": true,
      "notApplicableWithout": "browser_observation"
    },
    {
      "id": "BITM-03",
      "category": "link",
      "title": "Message, email, QR or call leads to a site presenting another brand's authentication with relay behaviour",
      "evidence": [
        "correlation",
        "auth_origin",
        "realtime_relay"
      ],
      "platformDependent": true,
      "notApplicableWithout": "browser_observation"
    },
    {
      "id": "BITM-04",
      "category": "link",
      "title": "MFA or security-code interaction on an unrelated authentication origin with observable relay evidence",
      "evidence": [
        "code_interaction",
        "auth_origin",
        "realtime_relay"
      ],
      "platformDependent": true,
      "notApplicableWithout": "browser_observation"
    },
    {
      "id": "BITM-05",
      "category": "link",
      "title": "Destination matches authoritative intelligence for active BitM/AiTM phishing infrastructure",
      "evidence": [
        "reputation"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "MSG-01",
      "category": "message",
      "title": "OTP, MFA or security code requested",
      "evidence": [
        "signals.code_request"
      ]
    },
    {
      "id": "MSG-02",
      "category": "message",
      "title": "Password, PIN or login credential requested",
      "evidence": [
        "signals.login_request",
        "signals.identity_request"
      ]
    },
    {
      "id": "MSG-03",
      "category": "message",
      "title": "Banking or card credentials requested",
      "evidence": [
        "signals.identity_request"
      ]
    },
    {
      "id": "MSG-04",
      "category": "message",
      "title": "Transfer to a safe or protected account requested",
      "evidence": [
        "signals.safe_account"
      ]
    },
    {
      "id": "MSG-05",
      "category": "message",
      "title": "Gift-card payment requested",
      "evidence": [
        "signals.gift_cards"
      ]
    },
    {
      "id": "MSG-06",
      "category": "message",
      "title": "Remote access or screen sharing requested in a suspicious context",
      "evidence": [
        "signals.remote_access"
      ]
    },
    {
      "id": "MSG-07",
      "category": "message",
      "title": "App or software installation requested in a suspicious context",
      "evidence": [
        "signals.remote_access",
        "signals.install_request"
      ]
    },
    {
      "id": "MSG-08",
      "category": "message",
      "title": "Government or authority impersonation with payment, credential, code or threat",
      "evidence": [
        "signals.brand_kind",
        "signals.payment_request",
        "signals.threat"
      ]
    },
    {
      "id": "MSG-09",
      "category": "message",
      "title": "Extortion",
      "evidence": [
        "signals.extortion"
      ]
    },
    {
      "id": "MSG-10",
      "category": "message",
      "title": "Advance-fee mechanics",
      "evidence": [
        "signals.advance_fee"
      ]
    },
    {
      "id": "MSG-11",
      "category": "message",
      "title": "Fake-payment mechanics",
      "evidence": [
        "signals.fake_payment"
      ]
    },
    {
      "id": "MSG-12",
      "category": "message",
      "title": "Malicious or deceptive link in the message",
      "evidence": [
        "link_outcome"
      ]
    },
    {
      "id": "MSG-13",
      "category": "message",
      "title": "Family or new-number impersonation with a money, credential or code request",
      "evidence": [
        "signals.family_claim",
        "signals.new_number",
        "signals.money_request"
      ]
    },
    {
      "id": "MSG-14",
      "category": "message",
      "title": "Brand impersonation with a consequential action and inconsistent contact or destination",
      "evidence": [
        "signals.claimed_brand",
        "brand_mismatch"
      ]
    },
    {
      "id": "MSG-15",
      "category": "message",
      "title": "Guaranteed-return or investment approach with payment or crypto transfer",
      "evidence": [
        "signals.guaranteed_returns",
        "signals.crypto"
      ]
    },
    {
      "id": "MSG-16",
      "category": "message",
      "title": "Job offer with advance payment, crypto, gift cards or credential harvesting",
      "evidence": [
        "signals.job_offer",
        "signals.payment_request"
      ]
    },
    {
      "id": "MSG-17",
      "category": "message",
      "title": "Romance interaction with a suspicious financial request",
      "evidence": [
        "signals.romance_escalation"
      ]
    },
    {
      "id": "MSG-18",
      "category": "message",
      "title": "Sensitive identity request with impersonation or anomaly",
      "evidence": [
        "signals.identity_request",
        "signals.claimed_brand"
      ]
    },
    {
      "id": "MSG-19",
      "category": "message",
      "title": "Platform switching combined with another scam mechanic",
      "evidence": [
        "signals.platform_switch"
      ]
    },
    {
      "id": "MSG-20",
      "category": "message",
      "title": "Urgency or threat with a consequential action and a supporting anomaly",
      "evidence": [
        "signals.urgency",
        "signals.threat"
      ]
    },
    {
      "id": "MSG-21",
      "category": "message",
      "title": "Claimed or uncertain identity with a consequential action and another deterministic anomaly",
      "evidence": [
        "signals.unknown_sender",
        "signals.claimed_brand"
      ]
    },
    {
      "id": "MSG-22",
      "category": "message",
      "title": "Multiple moderate scam indicators form a coherent scam pattern",
      "evidence": [
        "signals"
      ]
    },
    {
      "id": "PAY-01",
      "category": "message",
      "title": "Instant-payment request with authority, family or business impersonation",
      "evidence": [
        "signals.instant_payment",
        "signals.claimed_brand"
      ]
    },
    {
      "id": "PAY-02",
      "category": "message",
      "title": "Instant-payment request with urgency or threat and a sender anomaly",
      "evidence": [
        "signals.instant_payment",
        "signals.urgency"
      ]
    },
    {
      "id": "PAY-03",
      "category": "message",
      "title": "Unexpected change of payment destination with an immediate-payment request",
      "evidence": [
        "signals.instant_payment",
        "signals.payment_change"
      ]
    },
    {
      "id": "FWD-01",
      "category": "message",
      "title": "Instruction to enter a forwarding service code in a suspicious account or authority context",
      "evidence": [
        "signals.forwarding_code",
        "signals.claimed_brand"
      ]
    },
    {
      "id": "FWD-02",
      "category": "message",
      "title": "Instruction designed to redirect calls, messages or security codes to another number",
      "evidence": [
        "signals.forwarding_intent"
      ]
    },
    {
      "id": "CB-01",
      "category": "message",
      "title": "Claimed charge or account problem with a supplied callback number inconsistent with the claimed organisation",
      "evidence": [
        "signals.callback_request",
        "signals.alleged_charge"
      ]
    },
    {
      "id": "CB-02",
      "category": "message",
      "title": "Urgent cancellation, refund or security lure with a suspicious callback number",
      "evidence": [
        "signals.callback_request",
        "signals.urgency"
      ]
    },
    {
      "id": "CB-03",
      "category": "message",
      "title": "Callback number reputation is clean but strong impersonation evidence remains",
      "evidence": [
        "signals.callback_request",
        "phone_reputation"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "CALL-01",
      "category": "call",
      "title": "OTP or security code requested",
      "evidence": [
        "asks.code"
      ]
    },
    {
      "id": "CALL-02",
      "category": "call",
      "title": "Password or PIN requested",
      "evidence": [
        "asks.password"
      ]
    },
    {
      "id": "CALL-03",
      "category": "call",
      "title": "Banking or card credentials requested",
      "evidence": [
        "asks.bankdetails"
      ]
    },
    {
      "id": "CALL-04",
      "category": "call",
      "title": "Safe-account transfer requested",
      "evidence": [
        "asks.transfer",
        "claim"
      ]
    },
    {
      "id": "CALL-05",
      "category": "call",
      "title": "Gift-card payment requested",
      "evidence": [
        "asks.giftcards"
      ]
    },
    {
      "id": "CALL-06",
      "category": "call",
      "title": "Suspicious cryptocurrency transfer requested",
      "evidence": [
        "asks.crypto"
      ]
    },
    {
      "id": "CALL-07",
      "category": "call",
      "title": "Remote access or screen sharing requested",
      "evidence": [
        "asks.remote",
        "asks.screen"
      ]
    },
    {
      "id": "CALL-08",
      "category": "call",
      "title": "Software or app installation requested",
      "evidence": [
        "asks.install"
      ]
    },
    {
      "id": "CALL-09",
      "category": "call",
      "title": "Call or SMS forwarding instruction",
      "evidence": [
        "asks.forwarding"
      ]
    },
    {
      "id": "CALL-10",
      "category": "call",
      "title": "Government or authority payment threat",
      "evidence": [
        "claim",
        "asks.transfer"
      ]
    },
    {
      "id": "CALL-11",
      "category": "call",
      "title": "Unsolicited technical support seeking device access",
      "evidence": [
        "claim",
        "asks.remote"
      ]
    },
    {
      "id": "CALL-12",
      "category": "call",
      "title": "Suspicious investment solicitation with a consequential financial action",
      "evidence": [
        "claim",
        "asks.transfer"
      ]
    },
    {
      "id": "CALL-13",
      "category": "call",
      "title": "Claimed authority with a sensitive action and suspicious behaviour",
      "evidence": [
        "claim",
        "asks"
      ]
    },
    {
      "id": "CALL-14",
      "category": "call",
      "title": "Unexpected refund or payment manipulation",
      "evidence": [
        "asks.refund"
      ]
    },
    {
      "id": "CALL-15",
      "category": "call",
      "title": "Reputation evidence with matching scam behaviour",
      "evidence": [
        "phone_reputation",
        "asks"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "CALL-16",
      "category": "call",
      "title": "Call followed by a remote-access app, permission or device change forms a coherent sequence",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "EMAIL-01",
      "category": "email",
      "title": "Claimed brand with sender-domain mismatch and a consequential action",
      "evidence": [
        "sender_domain",
        "claimed_brand"
      ]
    },
    {
      "id": "EMAIL-02",
      "category": "email",
      "title": "Freemail or unrelated domain impersonates a brand with a sensitive request",
      "evidence": [
        "sender_domain",
        "claimed_brand"
      ]
    },
    {
      "id": "EMAIL-03",
      "category": "email",
      "title": "Account or security alert with an off-domain, lookalike or deceptive link",
      "evidence": [
        "link_domains",
        "findings"
      ]
    },
    {
      "id": "EMAIL-04",
      "category": "email",
      "title": "Credential request",
      "evidence": [
        "findings"
      ]
    },
    {
      "id": "EMAIL-05",
      "category": "email",
      "title": "OTP or security-code request",
      "evidence": [
        "findings"
      ]
    },
    {
      "id": "EMAIL-06",
      "category": "email",
      "title": "Invoice or payment request with changed bank details",
      "evidence": [
        "findings"
      ]
    },
    {
      "id": "EMAIL-07",
      "category": "email",
      "title": "Executive or BEC impersonation with an unusual financial request and sender anomaly",
      "evidence": [
        "findings",
        "sender_domain"
      ]
    },
    {
      "id": "EMAIL-08",
      "category": "email",
      "title": "Material From/Reply-To mismatch with a consequential action",
      "evidence": [
        "reply_to",
        "sender_domain"
      ]
    },
    {
      "id": "EMAIL-09",
      "category": "email",
      "title": "An embedded link produces a link-triage Possible Threat",
      "evidence": [
        "link_outcome"
      ]
    },
    {
      "id": "EMAIL-10",
      "category": "email",
      "title": "An attachment produces a file-triage Possible Threat",
      "evidence": [
        "attachment_outcome"
      ]
    },
    {
      "id": "EMAIL-11",
      "category": "email",
      "title": "Authentication failure with a consequential request or anomaly",
      "evidence": [
        "auth_results"
      ],
      "gapCode": "EMAIL_HEADERS_UNAVAILABLE"
    },
    {
      "id": "EMAIL-12",
      "category": "email",
      "title": "Authenticated legitimate sender with changed payment details, malicious link, unusual credential request or dangerous attachment",
      "evidence": [
        "auth_results",
        "findings"
      ]
    },
    {
      "id": "EMAIL-13",
      "category": "email",
      "title": "Multiple moderate email anomalies form a coherent scam pattern",
      "evidence": [
        "findings"
      ]
    },
    {
      "id": "CAL-01",
      "category": "email",
      "title": "External or unverified calendar invitation with a malicious or deceptive link",
      "evidence": [
        "calendar",
        "link_outcome"
      ],
      "platformDependent": true,
      "gapCode": "CONTENT_NOT_ACCESSIBLE"
    },
    {
      "id": "CAL-02",
      "category": "email",
      "title": "Calendar invitation with a suspicious financial or account lure and a callback number",
      "evidence": [
        "calendar",
        "signals.callback_request"
      ],
      "platformDependent": true,
      "gapCode": "CONTENT_NOT_ACCESSIBLE"
    },
    {
      "id": "CAL-03",
      "category": "email",
      "title": "Calendar invitation with a credential or payment collection destination",
      "evidence": [
        "calendar",
        "credential_interaction"
      ],
      "platformDependent": true,
      "gapCode": "CONTENT_NOT_ACCESSIBLE"
    },
    {
      "id": "FORM-01",
      "category": "email",
      "title": "Legitimate form service requesting a password, MFA or security code",
      "evidence": [
        "form_host",
        "credential_interaction"
      ]
    },
    {
      "id": "FORM-02",
      "category": "email",
      "title": "Legitimate form host collecting banking or card credentials in a suspicious originating context",
      "evidence": [
        "form_host",
        "findings"
      ]
    },
    {
      "id": "FORM-03",
      "category": "email",
      "title": "Legitimate form host collecting sensitive identity with impersonation or account-security lure",
      "evidence": [
        "form_host",
        "claimed_brand"
      ]
    },
    {
      "id": "BREACH-01",
      "category": "account",
      "title": "Confirmed exposed credential evidence alongside current credential-harvesting or takeover activity",
      "evidence": [
        "breach",
        "findings"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "APP-01",
      "category": "app",
      "title": "Remote-access app or activity follows a suspicious call, message or site",
      "evidence": [
        "correlation",
        "app_capabilities"
      ]
    },
    {
      "id": "APP-02",
      "category": "app",
      "title": "Sideload follows a suspicious link or message",
      "evidence": [
        "provenance",
        "correlation"
      ]
    },
    {
      "id": "APP-03",
      "category": "app",
      "title": "Sideloaded app impersonates a known brand",
      "evidence": [
        "provenance",
        "brand_mismatch"
      ]
    },
    {
      "id": "APP-04",
      "category": "app",
      "title": "Sideloaded app impersonates update, security or system software",
      "evidence": [
        "provenance",
        "claimed_role"
      ]
    },
    {
      "id": "APP-05",
      "category": "app",
      "title": "App communicates with a confirmed malicious destination",
      "evidence": [
        "destinations",
        "reputation"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "APP-06",
      "category": "app",
      "title": "Unexpected accessibility access with suspicious provenance or Threat Scent",
      "evidence": [
        "app_capabilities",
        "provenance"
      ]
    },
    {
      "id": "APP-07",
      "category": "app",
      "title": "Unexpected device-admin with suspicious provenance or Threat Scent",
      "evidence": [
        "app_capabilities",
        "provenance"
      ]
    },
    {
      "id": "APP-08",
      "category": "app",
      "title": "Unexpected screen sharing with suspicious provenance or Threat Scent",
      "evidence": [
        "app_capabilities",
        "provenance"
      ]
    },
    {
      "id": "APP-09",
      "category": "app",
      "title": "Unexpected install-app capability with suspicious provenance or Threat Scent",
      "evidence": [
        "app_capabilities",
        "provenance"
      ]
    },
    {
      "id": "APP-10",
      "category": "app",
      "title": "Multiple high-impact permissions with suspicious installation provenance",
      "evidence": [
        "app_capabilities",
        "provenance"
      ]
    },
    {
      "id": "APP-11",
      "category": "app",
      "title": "Install, then sensitive permission change, then suspicious network activity forms a coherent sequence",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "PWA-01",
      "category": "app",
      "title": "PWA installation originates from a deceptive or known-malicious site",
      "evidence": [
        "pwa_origin",
        "reputation"
      ],
      "platformDependent": true,
      "gapCode": "BROWSER_VISIBILITY_UNAVAILABLE"
    },
    {
      "id": "PWA-02",
      "category": "app",
      "title": "Newly registered or unrated PWA origin with brand impersonation and login, payment or account interaction",
      "evidence": [
        "pwa_origin",
        "domain_age",
        "credential_interaction"
      ],
      "platformDependent": true,
      "gapCode": "BROWSER_VISIBILITY_UNAVAILABLE"
    },
    {
      "id": "PWA-03",
      "category": "app",
      "title": "PWA installation immediately follows a correlated scam message, email or link",
      "evidence": [
        "pwa_origin",
        "correlation"
      ],
      "platformDependent": true,
      "gapCode": "BROWSER_VISIBILITY_UNAVAILABLE"
    },
    {
      "id": "FILE-01",
      "category": "file",
      "title": "Executable or script disguised as a document or image",
      "evidence": [
        "declared_type",
        "actual_type"
      ]
    },
    {
      "id": "FILE-02",
      "category": "file",
      "title": "Dangerous double extension",
      "evidence": [
        "filename"
      ]
    },
    {
      "id": "FILE-03",
      "category": "file",
      "title": "Right-to-left filename deception",
      "evidence": [
        "filename"
      ]
    },
    {
      "id": "FILE-04",
      "category": "file",
      "title": "Unexpected executable or script",
      "evidence": [
        "extension",
        "provenance"
      ]
    },
    {
      "id": "FILE-05",
      "category": "file",
      "title": "Suspicious APK",
      "evidence": [
        "extension",
        "provenance"
      ]
    },
    {
      "id": "FILE-06",
      "category": "file",
      "title": "APK impersonates a brand or update",
      "evidence": [
        "extension",
        "brand_mismatch"
      ]
    },
    {
      "id": "FILE-07",
      "category": "file",
      "title": "Unexpected configuration profile",
      "evidence": [
        "extension"
      ]
    },
    {
      "id": "FILE-08",
      "category": "file",
      "title": "Unexpected trust certificate",
      "evidence": [
        "extension"
      ]
    },
    {
      "id": "FILE-09",
      "category": "file",
      "title": "Macro-enabled document with suspicious provenance",
      "evidence": [
        "extension",
        "provenance"
      ]
    },
    {
      "id": "FILE-10",
      "category": "file",
      "title": "Embedded malicious or deceptive URL",
      "evidence": [
        "embedded_urls",
        "link_outcome"
      ]
    },
    {
      "id": "FILE-11",
      "category": "file",
      "title": "Dangerous PDF JavaScript, launch or embedded content",
      "evidence": [
        "pdf_features"
      ],
      "gapCode": "UNSUPPORTED_FILE_TYPE"
    },
    {
      "id": "FILE-12",
      "category": "file",
      "title": "Dangerous Office macro, external template or embedded object",
      "evidence": [
        "office_features"
      ],
      "gapCode": "UNSUPPORTED_FILE_TYPE"
    },
    {
      "id": "FILE-13",
      "category": "file",
      "title": "Archive contains an executable, script or dangerous nested content",
      "evidence": [
        "archive_entries"
      ],
      "gapCode": "ENCRYPTED_CONTENT"
    },
    {
      "id": "FILE-14",
      "category": "file",
      "title": "Archive contains path traversal or deceptive filenames",
      "evidence": [
        "archive_entries"
      ],
      "gapCode": "ENCRYPTED_CONTENT"
    },
    {
      "id": "FILE-15",
      "category": "file",
      "title": "Actual type materially contradicts the claimed type",
      "evidence": [
        "declared_type",
        "actual_type"
      ]
    },
    {
      "id": "ARCH-01",
      "category": "file",
      "title": "Password-protected archive with the password supplied in the originating message and a dangerous payload",
      "evidence": [
        "archive_encrypted",
        "correlation",
        "archive_entries"
      ]
    },
    {
      "id": "ARCH-02",
      "category": "file",
      "title": "Password supplied separately but correlated to the same case with a dangerous payload",
      "evidence": [
        "archive_encrypted",
        "correlation",
        "archive_entries"
      ]
    },
    {
      "id": "ARCH-03",
      "category": "file",
      "title": "Password-protected archive with a suspicious sender or lure and contents that cannot be inspected",
      "evidence": [
        "archive_encrypted",
        "correlation"
      ],
      "gapCode": "ENCRYPTED_CONTENT"
    },
    {
      "id": "FQR-01",
      "category": "file",
      "title": "QR code detected in a file or image — destination is triaged as a link",
      "evidence": [
        "qr_payload"
      ]
    },
    {
      "id": "DEV-01",
      "category": "device",
      "title": "Trusted OS security facility reports malware or a threat",
      "evidence": [
        "os_threat"
      ],
      "platformDependent": true,
      "gapCode": "PLATFORM_CAPABILITY_UNAVAILABLE"
    },
    {
      "id": "DEV-02",
      "category": "device",
      "title": "Remote-access activation correlates with suspicious activity",
      "evidence": [
        "remote_access_active",
        "correlation"
      ]
    },
    {
      "id": "DEV-03",
      "category": "device",
      "title": "Unexpected management or profile change with suspicious activity",
      "evidence": [
        "management_change",
        "correlation"
      ]
    },
    {
      "id": "DEV-04",
      "category": "device",
      "title": "Unexpected trusted certificate with suspicious activity",
      "evidence": [
        "certificate_change",
        "correlation"
      ]
    },
    {
      "id": "DEV-05",
      "category": "device",
      "title": "New app with unexpected accessibility and relevant Threat Scent",
      "evidence": [
        "app_capabilities",
        "correlation"
      ]
    },
    {
      "id": "DEV-06",
      "category": "device",
      "title": "New app with unexpected device-admin and relevant Threat Scent",
      "evidence": [
        "app_capabilities",
        "correlation"
      ]
    },
    {
      "id": "DEV-07",
      "category": "device",
      "title": "Suspicious VPN installation or change with suspicious app or scam activity",
      "evidence": [
        "vpn_change",
        "correlation"
      ]
    },
    {
      "id": "DEV-08",
      "category": "device",
      "title": "Multiple device-security changes form a coherent high-risk sequence",
      "evidence": [
        "device_changes"
      ]
    },
    {
      "id": "DEV-09",
      "category": "device",
      "title": "System-integrity indicators with supporting compromise evidence",
      "evidence": [
        "integrity",
        "correlation"
      ]
    },
    {
      "id": "DNS-01",
      "category": "device",
      "title": "DNS, Private DNS or DoH configuration unexpectedly changed with correlated suspicious activity",
      "evidence": [
        "dns_change",
        "correlation"
      ],
      "platformDependent": true,
      "gapCode": "PLATFORM_CAPABILITY_UNAVAILABLE"
    },
    {
      "id": "DNS-02",
      "category": "device",
      "title": "DNS server matches authoritative malicious infrastructure",
      "evidence": [
        "dns_server",
        "reputation"
      ],
      "platformDependent": true,
      "gapCode": "PLATFORM_CAPABILITY_UNAVAILABLE"
    },
    {
      "id": "DNS-03",
      "category": "device",
      "title": "DNS change with a preceding suspicious app installation or permission event",
      "evidence": [
        "dns_change",
        "correlation"
      ],
      "platformDependent": true,
      "gapCode": "PLATFORM_CAPABILITY_UNAVAILABLE"
    },
    {
      "id": "PUSH-01",
      "category": "device",
      "title": "Browser notification from a deceptive origin with a fake security or financial warning and an action lure",
      "evidence": [
        "push_origin",
        "credential_interaction"
      ],
      "platformDependent": true,
      "gapCode": "BROWSER_VISIBILITY_UNAVAILABLE"
    },
    {
      "id": "PUSH-02",
      "category": "device",
      "title": "Notification impersonates ApolloSG, the OS, a bank or a known service with an inconsistent destination",
      "evidence": [
        "push_origin",
        "brand_mismatch"
      ],
      "platformDependent": true,
      "gapCode": "BROWSER_VISIBILITY_UNAVAILABLE"
    },
    {
      "id": "PUSH-03",
      "category": "device",
      "title": "Web-push notification leads to a malicious or deceptive URL",
      "evidence": [
        "push_origin",
        "link_outcome"
      ],
      "platformDependent": true,
      "gapCode": "BROWSER_VISIBILITY_UNAVAILABLE"
    },
    {
      "id": "NET-01",
      "category": "network",
      "title": "Confirmed malicious destination observed",
      "evidence": [
        "destinations",
        "reputation"
      ],
      "gapCode": "INTELLIGENCE_PROVIDER_UNAVAILABLE"
    },
    {
      "id": "NET-02",
      "category": "network",
      "title": "Captive-portal destination triggers a link Possible Threat",
      "evidence": [
        "captive_url",
        "link_outcome"
      ]
    },
    {
      "id": "NET-03",
      "category": "network",
      "title": "Unexpected VPN change with suspicious app or device activity",
      "evidence": [
        "vpn_change",
        "correlation"
      ]
    },
    {
      "id": "NET-04",
      "category": "network",
      "title": "Network behaviour correlates with an existing suspicious incident",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "NET-05",
      "category": "network",
      "title": "App, site or device sequence communicates with malicious infrastructure",
      "evidence": [
        "destinations",
        "correlation"
      ]
    },
    {
      "id": "TLS-01",
      "category": "network",
      "title": "HTTPS certificate validation fails unexpectedly during a sensitive interaction in a suspicious network context",
      "evidence": [
        "tls_validation",
        "credential_interaction"
      ],
      "platformDependent": true,
      "gapCode": "PLATFORM_CAPABILITY_UNAVAILABLE"
    },
    {
      "id": "TLS-02",
      "category": "network",
      "title": "Unexpected self-signed or untrusted certificate presented for a legitimate sensitive service",
      "evidence": [
        "tls_validation"
      ],
      "platformDependent": true,
      "gapCode": "PLATFORM_CAPABILITY_UNAVAILABLE"
    },
    {
      "id": "TLS-03",
      "category": "network",
      "title": "Certificate identity does not match the requested legitimate domain",
      "evidence": [
        "tls_identity"
      ],
      "platformDependent": true,
      "gapCode": "PLATFORM_CAPABILITY_UNAVAILABLE"
    },
    {
      "id": "TLS-04",
      "category": "network",
      "title": "Newly introduced trusted root certificate with correlated suspicious network behaviour",
      "evidence": [
        "certificate_change",
        "correlation"
      ],
      "platformDependent": true,
      "gapCode": "PLATFORM_CAPABILITY_UNAVAILABLE"
    },
    {
      "id": "CORR-01",
      "category": "correlation",
      "title": "Suspicious call requesting remote access, then remote-access install, then accessibility or screen-sharing permission",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "CORR-02",
      "category": "correlation",
      "title": "Message, then deceptive link, then APK or PWA installation",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "CORR-03",
      "category": "correlation",
      "title": "Email, then changed bank details, then instant-payment request",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "CORR-04",
      "category": "correlation",
      "title": "Email or QR, then deceptive authentication site, then BitM/AiTM indicators",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "CORR-05",
      "category": "correlation",
      "title": "Callback lure followed by a suspicious call with matching claimed identity",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "CORR-06",
      "category": "correlation",
      "title": "Suspicious app installation followed by a DNS, VPN or accessibility change",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "CORR-07",
      "category": "correlation",
      "title": "Website or download, then executable, then malicious destination",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "CORR-08",
      "category": "correlation",
      "title": "Password-protected archive with the password supplied in the originating message or email",
      "evidence": [
        "correlation"
      ]
    },
    {
      "id": "CORR-09",
      "category": "correlation",
      "title": "Scam site, then notification permission, then a later deceptive web-push lure",
      "evidence": [
        "correlation"
      ]
    }
  ],
  "neverAloneAThreat": {
    "link": [
      "http scheme",
      "bare IP address",
      "punycode",
      "unusual port",
      "risky TLD",
      "shortener",
      "long URL",
      "deep subdomains",
      "encoded characters",
      "newly registered domain",
      "QR code itself",
      "data: or blob: scheme",
      "WebSocket/WebRTC/Socket.IO traffic",
      "binary payloads",
      "message frequency",
      "high-entropy traffic"
    ],
    "message": [
      "unknown sender",
      "urgency",
      "ordinary payment discussion",
      "PayID/Osko use",
      "brand mention",
      "job, investment or romance discussion without scam mechanics",
      "star/hash service code without context"
    ],
    "call": [
      "unknown caller",
      "number not in contacts",
      "caller identity unavailable",
      "unknown number reputation",
      "negative reputation without matching behaviour"
    ],
    "email": [
      "calendar invitation",
      "form-builder domain",
      "valid SPF/DKIM/DMARC from a form provider",
      "breach appearance alone"
    ],
    "app": [
      "official-store provenance",
      "expected permissions",
      "PWA installation alone"
    ],
    "file": [
      "encryption or password protection alone",
      "ordinary file characteristics",
      "QR code itself"
    ],
    "device": [
      "expected management or device administration",
      "expected accessibility",
      "ApolloSG or trusted VPN",
      "developer options",
      "custom DNS or DoH provider",
      "notification permission",
      "platform-unavailable signals"
    ],
    "network": [
      "public Wi-Fi",
      "open or WEP Wi-Fi",
      "unknown Wi-Fi",
      "lookalike SSID",
      "captive portal",
      "trusted home or work connection",
      "cellular connection"
    ],
    "correlation": [
      "time proximity"
    ]
  }
} as const;

export default CATALOGUE;
