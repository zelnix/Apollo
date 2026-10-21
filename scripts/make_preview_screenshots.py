"""Generate preview-only sample screenshots (SMS / email / banking alert) for the
Ask Higgins screenshot picker. These are drawn locally — no external assets."""

import os
from PIL import Image, ImageDraw, ImageFont

OUT = "/app/frontend/assets/images/preview"
os.makedirs(OUT, exist_ok=True)

R = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
B = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

W, H = 720, 1280

# Every drawn text block is recorded with the box it occupies. The preview's simulated text
# recogniser replays exactly these blocks, so what it "reads" is genuinely what the pixels show —
# nothing is invented at read time.
BLOCKS: "dict[str, list]" = {}
CUR: list = []


def rec(text, x0, y0, x1, y1, locatable=True):
    """Record a drawn text block. locatable=False means the recogniser reads the text but
    returns no usable box for it — Apollo then cannot black it out."""
    CUR.append({
        "text": text,
        "frame": ({"x": int(x0), "y": int(y0), "width": int(x1 - x0), "height": int(y1 - y0)}
                  if locatable else None),
    })


def save(img, name):
    global CUR
    img.save(f"{OUT}/{name}.png")
    BLOCKS[name] = CUR
    CUR = []


def f(path, size):
    return ImageFont.truetype(path, size)


def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def base(title, subtitle, accent="#1B2437"):
    img = Image.new("RGB", (W, H), "#FFFFFF")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 70], fill="#101521")
    d.text((24, 24), "11:37", font=f(B, 24), fill="#FFFFFF")
    d.text((W - 110, 24), "83%", font=f(R, 24), fill="#FFFFFF")
    d.rectangle([0, 70, W, 180], fill=accent)
    d.text((28, 98), title, font=f(B, 34), fill="#FFFFFF")
    d.text((28, 142), subtitle, font=f(R, 22), fill="#D5DBE6")
    rec(title, 28, 94, 28 + d.textlength(title, font=f(B, 34)), 138)
    rec(subtitle, 28, 138, 28 + d.textlength(subtitle, font=f(R, 22)), 172)
    return img, d


def bubble(d, y, text, font, incoming=True, max_w=520):
    lines = wrap(d, text, font, max_w)
    h = len(lines) * 32 + 32
    x0 = 28 if incoming else W - 28 - (max_w + 32)
    d.rounded_rectangle([x0, y, x0 + max_w + 32, y + h], radius=22,
                        fill="#EEF1F6" if incoming else "#2E9E6B")
    for i, ln in enumerate(lines):
        d.text((x0 + 16, y + 16 + i * 32), ln, font=font,
               fill="#101521" if incoming else "#FFFFFF")
    widest = max(d.textlength(ln, font=font) for ln in lines)
    rec(" ".join(lines), x0 + 14, y + 12, x0 + 18 + widest, y + h - 10)
    return y + h + 18


# 1. SMS: bank lookalike with link + password request
img, d = base("+61 448 221 905", "Text message · today 11:21", "#3B4A63")
y = 215
y = bubble(d, y, "CommBank: A payment of $920.00 to CRYPTO EXCHANGE LTD is pending.",
           f(R, 25))
y = bubble(d, y, "If this wasn't you, cancel it now at http://commbank-cancel.co/stop "
                 "and confirm your NetBank password.", f(R, 25))
y = bubble(d, y, "Failure to verify within 2 hours will lock your account.", f(R, 25))
save(img, "sim-shot-sms-bank")

# 2. Email: invoice bank-detail change
img, d = base("Inbox", "accounts@civic-plumbing-invoices.com", "#3B82C4")
y = 215
d.text((28, y), "Subject:", font=f(B, 24), fill="#5A6B7B")
y += 36
subject = "Updated bank details for invoice 4471 — please pay today"
top = y
for ln in wrap(d, subject, f(B, 28), W - 56):
    d.text((28, y), ln, font=f(B, 28), fill="#101521")
    y += 38
rec(f"Subject: {subject}", 28, top - 36, W - 28, y)
y += 18
body = ("Hi, our usual account is under audit so today's payment of $3,480 must go to "
        "our new account: BSB 063-000 ACC 1942 7781, name C P HOLDINGS. "
        "Please confirm by reply only — do not call the office number on the old invoice, "
        "the line is down. Attached: Invoice_4471.pdf.exe")
top = y
for ln in wrap(d, body, f(R, 25), W - 56):
    d.text((28, y), ln, font=f(R, 25), fill="#2B3344")
    y += 34
rec(body, 28, top, W - 28, y)
y += 20
d.rounded_rectangle([28, y, 420, y + 70], radius=12, fill="#F3F5F9",
                    outline="#C7CEDA")
d.text((48, y + 22), "Invoice_4471.pdf.exe", font=f(B, 23), fill="#101521")
rec("Invoice_4471.pdf.exe", 44, y + 18, 420, y + 56)
save(img, "sim-shot-email-invoice")

# 3. Ordinary delivery notice (benign)
img, d = base("AusPost", "Text message · today 09:04", "#2E9E6B")
y = 215
y = bubble(d, y, "Your parcel AP88213 was delivered to your front door at 2:14pm.",
           f(R, 25))
y = bubble(d, y, "Track future deliveries in the AusPost app you already have.",
           f(R, 25))
save(img, "sim-shot-delivery")

# 4. SMS: a genuine-looking verification code the sender then asks the person to forward.
#    The code is a credential, sitting in its own bubble, so Apollo can black out that box and
#    still send the rest of the conversation as evidence.
img, d = base("+61 476 300 112", "Text message · today 10:02", "#3B4A63")
y = 215
y = bubble(d, y, "Unusual sign-in blocked from Perth WA at 9:58 am.", f(R, 25))
y = bubble(d, y, "Your CommBank verification code is 884213.", f(R, 25))
y = bubble(d, y, "Reply with the code above so our team can verify you own the account.",
           f(R, 25))
save(img, "sim-shot-sms-code")

# 5. Email: a temporary password the recogniser reads but cannot place on the image.
#    Nothing can be blacked out with confidence, so Apollo refuses to send this one.
img, d = base("Inbox", "it-helpdesk@secure-mail-support.com", "#3B82C4")
y = 215
d.text((28, y), "Subject:", font=f(B, 24), fill="#5A6B7B")
y += 36
subject = "Your mailbox password has been reset"
top = y
for ln in wrap(d, subject, f(B, 28), W - 56):
    d.text((28, y), ln, font=f(B, 28), fill="#101521")
    y += 38
rec(f"Subject: {subject}", 28, top - 36, W - 28, y)
y += 18
intro = ("Hello, we have reset the password on your mailbox after unusual sign-in activity "
         "overnight.")
top = y
for ln in wrap(d, intro, f(R, 25), W - 56):
    d.text((28, y), ln, font=f(R, 25), fill="#2B3344")
    y += 34
rec(intro, 28, top, W - 28, y)
y += 14
cred = "Temporary password: Wint3r!Access24"
d.rounded_rectangle([28, y, W - 28, y + 58], radius=10, fill="#F3F5F9", outline="#C7CEDA")
d.text((48, y + 14), cred, font=f(B, 26), fill="#101521")
rec(cred, 0, 0, 0, 0, locatable=False)
y += 78
tail = ("Sign in at http://mail-login-secure.co/verify within 24 hours or the mailbox will be "
        "closed. Do not reply to this message.")
top = y
for ln in wrap(d, tail, f(R, 25), W - 56):
    d.text((28, y), ln, font=f(R, 25), fill="#2B3344")
    y += 34
rec(tail, 28, top, W - 28, y)
save(img, "sim-shot-email-password")

# The simulated recogniser reads this file — never the pixels — so the two always agree.
import json  # noqa: E402

lines = [
    "// GENERATED by scripts/make_preview_screenshots.py — do not edit by hand.",
    "//",
    "// The text each preview sample screenshot actually shows, with the box it occupies. The",
    "// preview's simulated text recogniser replays these blocks in place of on-device OCR, which",
    "// no web preview can run. Nothing here is a verdict: Apollo's real detection, redaction and",
    "// fail-closed rules then process these blocks exactly as they process a real device read.",
    "",
    "export interface SimulatedTextBlock {",
    "  text: string;",
    "  /** Where the text sits in the image, or null when the recogniser read it but could not locate it. */",
    "  frame: { x: number; y: number; width: number; height: number } | null;",
    "}",
    "",
    "export const SIMULATED_SCREENSHOT_TEXT: Record<string, SimulatedTextBlock[]> = {",
]
for name, blocks in BLOCKS.items():
    lines.append(f'  "{name}": [')
    for b in blocks:
        frame = "null" if b["frame"] is None else (
            "{ x: %(x)d, y: %(y)d, width: %(width)d, height: %(height)d }" % b["frame"])
        lines.append(f'    {{ text: {json.dumps(b["text"], ensure_ascii=False)}, frame: {frame} }},')
    lines.append("  ],")
lines += ["};", ""]
with open("/app/frontend/src/preview/simulatedScreenshotText.ts", "w") as fh:
    fh.write("\n".join(lines))

print("written:", sorted(os.listdir(OUT)))
print("blocks:", {k: len(v) for k, v in BLOCKS.items()})
