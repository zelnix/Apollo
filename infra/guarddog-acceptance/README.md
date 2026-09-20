# GuardDog Stage 1D dedicated controlled endpoint

This package deliberately does not point at a shared-IP public website. The only acceptable target
is a newly allocated public IPv4 dedicated to this acceptance endpoint.

## Exact hosting/DNS action still required

1. Allocate one small VM with a **new static public IPv4 used only for this endpoint** and record the
   cloud account/resource ID as ownership evidence.
2. Create one `A` record on an Apollo-owned DNS zone, for example
   `guarddog-acceptance.<owned-zone>`, whose complete IPv4 answer set contains exactly that address.
   Do not add AAAA, CDN, proxy or load-balancer records.
3. Install Caddy and this `Caddyfile`, set `GUARDDOG_ACCEPTANCE_HOST` and `ACME_EMAIL`, and allow TCP
   80/443 so ACME can issue a valid certificate. The endpoint returns exactly
   `APOLLO_GUARDDOG_ACCEPTANCE_V1\n` at `/apollo-guarddog-acceptance/v1` and 404 elsewhere.
4. Save the VM allocation and DNS-change evidence to an external ownership file. Run
   `verify_endpoint.py`; then run `frontend/scripts/provision_guarddog_acceptance.py` with that
   ownership file and the private key stored at
   `/root/.apollo-secrets/stage1d-acceptance-ed25519.pem` in this workspace.

No hosting or DNS credentials are available to this agent, so steps 1–3 are NOT RUN. The example
address in `endpoint.env.example` is documentation-only TEST-NET and is rejected by the verifier.