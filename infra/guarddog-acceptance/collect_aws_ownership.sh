#!/usr/bin/env bash
set -euo pipefail

: "${AWS_PROFILE:?Set a temporary read-only AWS profile}"
: "${AWS_REGION:=us-west-2}"
: "${GUARDDOG_CONTROLLED_HOST:=blocktest.btciq.app}"
: "${GUARDDOG_CONTROLLED_IPV4:=52.25.179.131}"
: "${GUARDDOG_ROUTE53_ZONE_ID:?Set the authoritative Route 53 hosted-zone ID}"
: "${GUARDDOG_EVIDENCE_DIR:?Set an external non-repository evidence directory}"

install -d -m 700 "$GUARDDOG_EVIDENCE_DIR"
aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION" --output json > "$GUARDDOG_EVIDENCE_DIR/caller.json"
aws ec2 describe-addresses --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --public-ips "$GUARDDOG_CONTROLLED_IPV4" --output json > "$GUARDDOG_EVIDENCE_DIR/eip.json"
aws ec2 describe-network-interfaces --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --filters "Name=association.public-ip,Values=$GUARDDOG_CONTROLLED_IPV4" --output json > "$GUARDDOG_EVIDENCE_DIR/eni.json"
aws route53 get-hosted-zone --profile "$AWS_PROFILE" --id "$GUARDDOG_ROUTE53_ZONE_ID" \
  --output json > "$GUARDDOG_EVIDENCE_DIR/hosted-zone.json"
aws route53 list-resource-record-sets --profile "$AWS_PROFILE" --hosted-zone-id "$GUARDDOG_ROUTE53_ZONE_ID" \
  --query "ResourceRecordSets[?Name=='${GUARDDOG_CONTROLLED_HOST}.' && Type=='A']" \
  --output json > "$GUARDDOG_EVIDENCE_DIR/record.json"

python - "$GUARDDOG_EVIDENCE_DIR" "$GUARDDOG_CONTROLLED_IPV4" "$GUARDDOG_CONTROLLED_HOST" <<'PY'
import hashlib, json, pathlib, sys
root, expected_ip, expected_host = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
eip = json.loads((root / "eip.json").read_text()).get("Addresses", [])
assert len(eip) == 1 and eip[0].get("PublicIp") == expected_ip and eip[0].get("AllocationId")
assert eip[0].get("AssociationId") and (eip[0].get("InstanceId") or eip[0].get("NetworkInterfaceId"))
records = json.loads((root / "record.json").read_text())
assert len(records) == 1 and records[0].get("Type") == "A"
assert [item["Value"] for item in records[0].get("ResourceRecords", [])] == [expected_ip]
receipt = {"host": expected_host, "ipv4": expected_ip, "allocationId": eip[0]["AllocationId"],
           "associationId": eip[0]["AssociationId"],
           "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob("*.json"))}}
(root / "ownership-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
PY