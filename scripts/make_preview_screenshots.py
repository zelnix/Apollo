"""Generate preview-only sample screenshots (SMS / email / banking alert) for the
Ask Higgins screenshot picker. These are drawn locally — no external assets."""

import os
from PIL import Image, ImageDraw, ImageFont

OUT = "/app/frontend/assets/images/preview"
os.makedirs(OUT, exist_ok=True)

R = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
B = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

W, H = 720, 1280


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
    return y + h + 18


# 1. SMS: bank lookalike with link + password request
img, d = base("+61 448 221 905", "Text message · today 11:21", "#3B4A63")
y = 215
y = bubble(d, y, "CommBank: A payment of $920.00 to CRYPTO EXCHANGE LTD is pending.",
           f(R, 25))
y = bubble(d, y, "If this wasn't you, cancel it now at http://commbank-cancel.co/stop "
                 "and confirm your NetBank password.", f(R, 25))
y = bubble(d, y, "Failure to verify within 2 hours will lock your account.", f(R, 25))
img.save(f"{OUT}/sim-shot-sms-bank.png")

# 2. Email: invoice bank-detail change
img, d = base("Inbox", "accounts@civic-plumbing-invoices.com", "#3B82C4")
y = 215
d.text((28, y), "Subject:", font=f(B, 24), fill="#5A6B7B")
y += 36
for ln in wrap(d, "Updated bank details for invoice 4471 — please pay today",
               f(B, 28), W - 56):
    d.text((28, y), ln, font=f(B, 28), fill="#101521")
    y += 38
y += 18
body = ("Hi, our usual account is under audit so today's payment of $3,480 must go to "
        "our new account: BSB 063-000 ACC 1942 7781, name C P HOLDINGS. "
        "Please confirm by reply only — do not call the office number on the old invoice, "
        "the line is down. Attached: Invoice_4471.pdf.exe")
for ln in wrap(d, body, f(R, 25), W - 56):
    d.text((28, y), ln, font=f(R, 25), fill="#2B3344")
    y += 34
y += 20
d.rounded_rectangle([28, y, 420, y + 70], radius=12, fill="#F3F5F9",
                    outline="#C7CEDA")
d.text((48, y + 22), "Invoice_4471.pdf.exe", font=f(B, 23), fill="#101521")
img.save(f"{OUT}/sim-shot-email-invoice.png")

# 3. Ordinary delivery notice (benign)
img, d = base("AusPost", "Text message · today 09:04", "#2E9E6B")
y = 215
y = bubble(d, y, "Your parcel AP88213 was delivered to your front door at 2:14pm.",
           f(R, 25))
y = bubble(d, y, "Track future deliveries in the AusPost app you already have.",
           f(R, 25))
img.save(f"{OUT}/sim-shot-delivery.png")

print("written:", sorted(os.listdir(OUT)))
