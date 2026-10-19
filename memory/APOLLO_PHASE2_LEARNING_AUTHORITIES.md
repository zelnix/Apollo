# Phase 2 and Learn with Higgins authoritative mandates

The product owner confirmed that both documents below are authoritative for this implementation pass:

1. Phase 2 Source Remediation Developer Instructions
   - `https://customer-assets-eiarnc6j.emergentagent.net/job_a5041cb8-28d9-44f8-8e40-18fe9e4a5e0e/artifacts/olkw0ayo_Apollo_Phase_2_Source_Remediation_Developer_Instructions-1.md`
2. Learn with Higgins Backend Content and Feed Technical Implementation Mandate
   - `https://customer-assets-eiarnc6j.emergentagent.net/job_a5041cb8-28d9-44f8-8e40-18fe9e4a5e0e/artifacts/p5ns1laj_Learn_with_Higgins_Backend_Content_and_Feed_Technical_Implementation_Mandate.md`

Controlling boundaries:
- Implement C22 first, then C23, C21, C24 and C25; preserve the existing investigation coordinator.
- Gemini uses only the owner's `GEMINI_API_KEY`; no Emergent-managed LLM key and no alternate model provider.
- No Playwright, testing agent, automated scenario suite, signed artifact claim, or physical-device acceptance claim.
- Android identity remains `app.apollo.hwg`.
- Consumer learning content is backend-published and governed; the mobile bundle contains no production article bodies or live-alert content.
- Government feeds enter a review queue and never publish independently.
- Admin permissions are distinct; mutations are audited without content snippets or secrets.