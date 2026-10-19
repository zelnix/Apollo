"""Summarise results.json into REPORT.md (per-category success, misses, false positives, evidence loss)."""
import json
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent


def summarise(run):
    cat = defaultdict(lambda: {"secrets": 0, "redacted": 0, "partial": 0, "missed": 0, "evidence": 0, "evidence_removed": 0, "labels_redacted": 0})
    misses, fps, labels = [], [], []
    for img in run:
        c = cat[img["category"]]
        for s in img["segments"]:
            if s["role"] == "secret":
                c["secrets"] += 1; c[s["verdict"]] += 1
                if s["verdict"] != "redacted": misses.append((img["id"], s["text"], s["verdict"], s["painted"]))
            elif s["role"] == "evidence":
                c["evidence"] += 1
                if s["verdict"] == "evidence_removed": c["evidence_removed"] += 1; fps.append((img["id"], s["text"], s["painted"]))
            elif s["verdict"] == "label_redacted":
                c["labels_redacted"] += 1; labels.append((img["id"], s["text"]))
    return cat, misses, fps, labels


def main():
    r = json.loads((HERE / "results.json").read_text())
    out = ["# Google DLP image.redact POC — results", "",
           f"Project: `{r['project']}`  ", f"Built-in infoTypes used: {', '.join(r['builtins_used'])}  ",
           f"Requested but unavailable: {', '.join(r['builtins_unavailable']) or 'none'}  ",
           f"API calls: {r['usage']['calls']}, billable bytes: {r['usage']['billable_bytes']:,} "
           f"(≈ ${r['usage']['approx_cost_usd_beyond_free_tier']} if beyond the 1 GiB/month free tier)", ""]
    for name, run in r["runs"].items():
        cat, misses, fps, labels = summarise(run)
        tot_s = sum(c["secrets"] for c in cat.values()); tot_r = sum(c["redacted"] for c in cat.values())
        tot_e = sum(c["evidence"] for c in cat.values()); tot_x = sum(c["evidence_removed"] for c in cat.values())
        out += [f"## Configuration: {name}", "",
                f"Secrets fully redacted: **{tot_r}/{tot_s}**. Evidence items removed: **{tot_x}/{tot_e}**.", "",
                "| Category | Secrets | Redacted | Partial | Missed | Evidence items | Evidence removed | Labels redacted |",
                "|---|---|---|---|---|---|---|---|"]
        for k, c in cat.items():
            out.append(f"| {k} | {c['secrets']} | {c['redacted']} | {c['partial']} | {c['missed']} | {c['evidence']} | {c['evidence_removed']} | {c['labels_redacted']} |")
        out += ["", "**Missed / partial credentials**", ""] + ([f"- `{i}`: \"{t}\" — {v} ({p:.0%} covered)" for i, t, v, p in misses] or ["- none"])
        out += ["", "**Evidence incorrectly redacted (false positives)**", ""] + ([f"- `{i}`: \"{t}\" ({p:.0%} covered)" for i, t, p in fps] or ["- none"])
        out += ["", "**Non-evidence labels redacted**", ""] + ([f"- `{i}`: \"{t}\"" for i, t in labels] or ["- none"])
        out += ["", "**Per-image findings**", "", "| Image | Findings (infoType: quote) | ms |", "|---|---|---|"]
        for img in run:
            f = "; ".join(f"{x['info_type']}: {x['quote']}" for x in img["findings"]) or "—"
            out.append(f"| {img['id']} | {f.replace('|', '/')} | {img['ms']} |")
        out.append("")
    (HERE / "REPORT.md").write_text("\n".join(out))
    print("REPORT.md written")


if __name__ == "__main__":
    main()
