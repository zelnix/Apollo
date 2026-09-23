#!/usr/bin/env python3
"""Generate Apollo static UI exports and animated media without browser automation."""
from __future__ import annotations

import html
import json
import math
import shutil
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "apollo-media-kit"
SCREENS = OUT / "screens"
MASCOTS = OUT / "gifs" / "transparent"
DEMOS = OUT / "gifs" / "full-screen"
ASSETS = ROOT / "assets" / "images"
FONTS = ROOT / "assets" / "fonts"

PALETTE = {
    "surface": "#F5F7FA", "text": "#0B1220", "muted": "#52606D", "card": "#FFFFFF",
    "soft": "#EDF2F7", "border": "#D7E0EA", "navy": "#162235", "gold": "#C9A34A",
    "green": "#4FAF83", "amber": "#E8943A", "red": "#D9534F", "unknown": "#7A8794",
}
DEVICES = {"iphone": (390, 844), "android": (412, 915)}


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    file = {"regular": "Geist-400.ttf", "medium": "Geist-500.ttf", "semibold": "Geist-600.ttf",
            "display": "Outfit-600.ttf", "bold": "Outfit-700.ttf"}[weight]
    return ImageFont.truetype(str(FONTS / file), size)


def wrap(draw: ImageDraw.ImageDraw, value: str, face: ImageFont.FreeTypeFont, width: int) -> list[str]:
    words = value.split(); lines: list[str] = []; current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=face) <= width: current = candidate
        else:
            if current: lines.append(current)
            current = word
    if current: lines.append(current)
    return lines


def paragraph(draw, xy, value, width, size=15, color=None, weight="regular", spacing=5):
    face = font(size, weight); x, y = xy
    for line in wrap(draw, value, face, width):
        draw.text((x, y), line, font=face, fill=color or PALETTE["muted"]); y += size + spacing
    return y


def card(draw, box, fill=None, outline=None, radius=18):
    draw.rounded_rectangle(box, radius=radius, fill=fill or PALETTE["card"], outline=outline or PALETTE["border"], width=1)


def pill(draw, xy, label, tone="neutral"):
    colors = {"neutral": PALETTE["soft"], "resting": "#DFF3E9", "growling": "#FBE9D5", "barking": "#FBE0DF"}
    text_colors = {"neutral": PALETTE["muted"], "resting": "#1B6B47", "growling": "#9A4A0B", "barking": "#B3261E"}
    face = font(12, "semibold"); w = int(draw.textlength(label, font=face)) + 22; x, y = xy
    draw.rounded_rectangle((x, y, x+w, y+28), radius=14, fill=colors[tone]); draw.text((x+11, y+6), label, font=face, fill=text_colors[tone])
    return w


def button(draw, box, label, primary=True, disabled=False):
    fill = PALETTE["soft"] if not primary or disabled else PALETTE["navy"]
    color = PALETTE["muted"] if disabled else (PALETTE["text"] if not primary else "#FFFFFF")
    draw.rounded_rectangle(box, radius=13, fill=fill, outline=PALETTE["border"] if not primary else None)
    face = font(14, "semibold"); bounds = draw.textbbox((0, 0), label, font=face)
    draw.text(((box[0]+box[2]-(bounds[2]-bounds[0]))/2, (box[1]+box[3]-(bounds[3]-bounds[1]))/2-2), label, font=face, fill=color)


def base_screen(size, title, tab=None):
    w, h = size; image = Image.new("RGB", size, PALETTE["surface"]); draw = ImageDraw.Draw(image)
    draw.text((24, 13), "9:41", font=font(13, "semibold"), fill=PALETTE["text"])
    draw.rounded_rectangle((w-76, 17, w-28, 28), radius=6, outline=PALETTE["text"], width=2)
    draw.text((24, 52), title, font=font(28, "bold"), fill=PALETTE["text"])
    if tab:
        nav_top = h-82; draw.rectangle((0, nav_top, w, h), fill=PALETTE["text"])
        labels = ["Home", "Higgins", "Gates", "Check It", "Patrol"]
        for index, label in enumerate(labels):
            x = int((index + .5) * w / len(labels)); active = label == tab
            draw.ellipse((x-4, nav_top+15, x+4, nav_top+23), fill=PALETTE["gold"] if active else "#C3CEDA")
            face = font(10, "medium"); tw = draw.textlength(label, font=face)
            draw.text((x-tw/2, nav_top+34), label, font=face, fill="#E2C06B" if active else "#9EABB8")
        bottom = nav_top-12
    else:
        draw.rounded_rectangle((w-66, 48, w-22, 92), radius=22, fill=PALETTE["soft"]); draw.line((w-52, 62, w-36, 78), fill=PALETTE["text"], width=2); draw.line((w-36, 62, w-52, 78), fill=PALETTE["text"], width=2)
        bottom = h-20
    return image, draw, 106, bottom


def mascot_frame(name="patrolling", frame=0, size=130):
    source = Image.open(ASSETS / f"apollo-{name}.gif"); source.seek(frame % getattr(source, "n_frames", 1))
    rgba = source.convert("RGBA"); return ImageOps.contain(rgba, (size, size), Image.Resampling.LANCZOS)


def screen_home(size):
    im, d, y, bottom = base_screen(size, "Home", "Home"); w, _ = size
    card(d, (24, y, w-24, y+210), "#FFFFFF", "#C7CEDA", 22)
    dog = mascot_frame("patrolling", 0, 126); im.paste(dog, ((w-126)//2, y+8), dog)
    d.text((44, y+143), "Apollo is resting", font=font(22, "bold"), fill=PALETTE["text"])
    paragraph(d, (44, y+175), "Protected within the checks Apollo can currently see.", w-88, 13)
    y += 228; card(d, (24, y, w-24, y+104)); pill(d, (40, y+16), "10 Gates active", "resting")
    d.text((40, y+56), "Protection", font=font(17, "bold"), fill=PALETTE["navy"]); paragraph(d, (40, y+78), "No Gate needs your attention.", w-80, 13)
    y += 122; d.text((24, y), "Recent patrol", font=font(18, "display"), fill=PALETTE["text"]); y += 34
    card(d, (24, y, w-24, min(y+92, bottom))); d.text((40, y+18), "All quiet", font=font(16, "display"), fill=PALETTE["text"]); paragraph(d, (40, y+46), "Apollo is patrolling within the checks he can see.", w-80, 13)
    return im


def screen_higgins(size):
    im, d, y, bottom = base_screen(size, "Higgins", "Higgins"); w, _ = size
    pill(d, (w-116, 60), "Ordinary chat")
    d.text((24, y), "How Higgins can help", font=font(21, "bold"), fill=PALETTE["text"]); y += 42
    cards = [("Ordinary chat", "Plain-language explanations", "Chat with Higgins"), ("Learning", "Build simple scam-spotting habits", "Learn with Higgins"), ("New scams", "Australian government alerts", "View alerts"), ("Saved reports", "Return to reports you kept", "Open reports")]
    for title, body, action in cards:
        if y+112 > bottom: break
        card(d, (24, y, w-24, y+106)); d.text((40, y+14), title, font=font(16, "bold"), fill=PALETTE["text"]); paragraph(d, (40, y+41), body, w-80, 13); d.text((40, y+77), action, font=font(13, "semibold"), fill="#1B6B47"); y += 120
    return im


def screen_gates(size):
    im, d, y, bottom = base_screen(size, "Gates", "Gates"); w, _ = size
    card(d, (24, y, w-24, y+82)); pill(d, (40, y+14), "10 active", "resting"); paragraph(d, (40, y+50), "Current protection, with honest platform limits.", w-80, 13); y += 98
    for title, detail in [("Site Gate", "Safari and supported browser checks"), ("Link Gate", "Ready for links you submit"), ("Text Gate", "Message checks enabled"), ("Call Gate", "Call list prepared"), ("Network Gate", "Connection observation available")]:
        if y+76 > bottom: break
        card(d, (24, y, w-24, y+68)); d.ellipse((40, y+24, 52, y+36), fill=PALETTE["green"]); d.text((66, y+12), title, font=font(15, "bold"), fill=PALETTE["text"]); paragraph(d, (66, y+36), detail, w-106, 12); y += 78
    return im


def screen_patrol(size):
    im, d, y, bottom = base_screen(size, "Apollo's Patrol", "Patrol"); w, _ = size
    x=24
    for label in ["All activity", "Needs you", "Warnings"]:
        width=pill(d,(x,y),label,"neutral"); x += width+8
    y += 52; d.text((24, y), "TODAY", font=font(12, "semibold"), fill=PALETTE["muted"]); y += 34
    card(d, (24, y, w-24, y+126)); pill(d, (40, y+16), "Protected", "resting"); d.text((40, y+54), "No Patrol outcomes", font=font(17, "bold"), fill=PALETTE["text"]); paragraph(d, (40, y+82), "Commands and service messages stay out of Patrol. Check Gates for current protection.", w-80, 13)
    y += 144; card(d, (24, y, w-24, min(y+104,bottom))); d.text((40, y+16), "Saved reports", font=font(16, "bold"), fill=PALETTE["text"]); paragraph(d, (40, y+46), "Reports appear only when you deliberately keep them.", w-80, 13)
    return im


def screen_family(size):
    im, d, y, bottom = base_screen(size, "Family sharing"); w, _ = size
    paragraph(d, (24,y), "Share only serious alerts and calm weekly check-ins with someone you trust.", w-48, 14); y += 62
    card(d, (24,y,w-24,y+126)); d.text((40,y+16),"Family Help",font=font(18,"bold"),fill=PALETTE["text"]); paragraph(d,(40,y+48),"Ask someone you trust to watch your screen. They cannot control your device.",w-80,13); d.text((40,y+96),"Open Family Help  ›",font=font(13,"semibold"),fill=PALETTE["navy"]); y+=142
    card(d,(24,y,w-24,y+146)); d.text((40,y+16),"Email alerts",font=font(17,"bold"),fill=PALETTE["text"]); paragraph(d,(40,y+48),"No guardians added yet.",w-80,13); button(d,(40,y+86,w-40,y+132),"Send invitation",False,True); y+=162
    card(d,(24,y,w-24,min(y+138,bottom))); d.text((40,y+16),"Pair another Apollo device",font=font(17,"bold"),fill=PALETTE["text"]); paragraph(d,(40,y+48),"Create a six-character code for a trusted family member.",w-80,13); button(d,(40,y+86,w-40,min(y+132,bottom-10)),"Create pairing code",False)
    return im


def screen_family_help(size):
    im, d, y, bottom = base_screen(size, "Family Help"); w, _ = size
    card(d,(24,y,w-24,min(y+350,bottom)),outline="#C7CEDA",radius=22); d.ellipse((w//2-30,y+24,w//2+30,y+84),fill=PALETTE["soft"]); d.rectangle((w//2-17,y+40,w//2+17,y+66),outline=PALETTE["navy"],width=3)
    d.text((46,y+108),"Show your screen to",font=font(21,"bold"),fill=PALETTE["text"]); d.text((46,y+136),"someone you trust",font=font(21,"bold"),fill=PALETTE["text"])
    paragraph(d,(46,y+180),"You choose when sharing starts and stops. They can only watch — never tap, type, hear audio, record through Apollo, or control your device.",w-92,14)
    pill(d,(46,y+262),"Not available yet","neutral"); paragraph(d,(46,y+302),"Family Help is not available yet. Your other Apollo features still work.",w-92,13)
    button(d,(46,min(y+358,bottom-60),w-46,min(y+406,bottom-14)),"Ask family for help",True,True)
    return im


def screen_gmail(size):
    im, d, y, bottom = base_screen(size, "Email Gate"); w, _ = size
    card(d,(24,y,w-24,y+270)); d.text((40,y+16),"Connect Gmail (optional)",font=font(18,"bold"),fill=PALETTE["text"]); pill(d,(40,y+50),"Gmail OAuth connected — read-only","resting")
    button(d,(40,y+94,w-40,y+142),"Assess recent Gmail",True); button(d,(40,y+154,w-40,y+202),"Enable ongoing Gmail monitoring",False); paragraph(d,(40,y+218),"Ongoing monitoring is off.",w-80,13); y+=288
    d.text((24,y),"Check one email manually",font=font(18,"display"),fill=PALETTE["text"]); y+=38
    for label,height in [("From",48),("Subject",48),("Paste the email body…",100)]:
        d.rounded_rectangle((24,y,w-24,y+height),radius=12,fill=PALETTE["soft"],outline=PALETTE["border"]); d.text((40,y+15),label,font=font(14),fill=PALETTE["muted"]); y+=height+12
    if y+48<bottom: button(d,(24,y,w-24,y+48),"Check this email",True)
    return im


SCREEN_BUILDERS = {"home": screen_home, "higgins": screen_higgins, "gates": screen_gates, "patrol": screen_patrol,
                   "family": screen_family, "family-help": screen_family_help, "gmail-connected": screen_gmail}


def save_transparent_gif(state, source, overlay=None):
    image=Image.open(ASSETS/f"apollo-{source}.gif"); frames=[]; durations=[]
    for index in range(getattr(image,"n_frames",1)):
        image.seek(index); base=Image.new("RGBA",(360,360),(0,0,0,0)); frame=ImageOps.contain(image.convert("RGBA"),(300,300),Image.Resampling.LANCZOS); base.alpha_composite(frame,((360-frame.width)//2,(360-frame.height)//2))
        d=ImageDraw.Draw(base)
        if overlay=="blocked":
            d.ellipse((256,250,340,334),fill="#D9534F",outline="white",width=5); d.line((278,312,320,270),fill="white",width=9)
        if overlay=="success":
            d.ellipse((256,250,340,334),fill="#4FAF83",outline="white",width=5); d.line((276,291,291,307),fill="white",width=8); d.line((291,307,322,271),fill="white",width=8)
        frames.append(base); durations.append(image.info.get("duration",180))
    frames[0].save(MASCOTS/f"apollo-{state}.gif",save_all=True,append_images=frames[1:],duration=durations,loop=0,disposal=2,transparency=0,optimize=False)


def state_demo(state, source, color, headline, detail, overlay=None):
    src=Image.open(ASSETS/f"apollo-{source}.gif"); frames=[]
    for i in range(12):
        im,d,y,bottom=base_screen(DEVICES["iphone"],"Home","Home"); w,_=im.size
        card(d,(24,y,w-24,y+350),fill="#FFFFFF",outline=color,radius=22)
        pulse=int(8+5*math.sin(i/12*math.pi*2)); d.ellipse((w//2-82-pulse,y+28-pulse,w//2+82+pulse,y+192+pulse),outline=color,width=3)
        src.seek(i%getattr(src,"n_frames",1)); dog=ImageOps.contain(src.convert("RGBA"),(160,160),Image.Resampling.LANCZOS); im.paste(dog,((w-dog.width)//2,y+30),dog)
        if overlay=="blocked": d.line((w//2-64,y+62,w//2+64,y+180),fill=PALETTE["red"],width=9)
        if overlay=="success": d.ellipse((w//2+50,y+150,w//2+96,y+196),fill=PALETTE["green"]); d.line((w//2+61,y+172,w//2+72,y+184),fill="white",width=6); d.line((w//2+72,y+184,w//2+88,y+163),fill="white",width=6)
        tw=d.textlength(headline,font=font(23,"bold")); d.text(((w-tw)/2,y+220),headline,font=font(23,"bold"),fill=PALETTE["text"]); paragraph(d,(46,y+262),detail,w-92,14)
        button(d,(46,y+305,w-46,y+351),"View protection",state not in {"barking","biting"})
        frames.append(im)
    frames[0].save(DEMOS/f"apollo-{state}-ui-demo.gif",save_all=True,append_images=frames[1:],duration=110,loop=0,disposal=2,optimize=False)


def gallery(entries):
    groups={"Screen captures":[],"Transparent Apollo loops":[],"Full-screen state demonstrations":[]}
    for row in entries: groups[row["group"]].append(row)
    sections=[]
    for title, rows in groups.items():
        cards="".join(f'<a class="card" href="{html.escape(r["path"])}" download><img src="{html.escape(r["path"])}" alt="{html.escape(r["label"])}"><strong>{html.escape(r["label"])}</strong><span>Download</span></a>' for r in rows)
        sections.append(f"<section><h2>{title}</h2><div class='grid'>{cards}</div></section>")
    return f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Apollo media kit</title><style>body{{margin:0;background:#F5F7FA;color:#0B1220;font-family:Arial,sans-serif}}main{{max-width:1180px;margin:auto;padding:32px}}h1{{font-size:34px}}p{{color:#52606D;line-height:1.6}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px}}.card{{background:white;border:1px solid #D7E0EA;border-radius:18px;padding:14px;text-decoration:none;color:#0B1220;display:flex;flex-direction:column;gap:10px}}.card img{{width:100%;height:320px;object-fit:contain;background:#EDF2F7;border-radius:12px}}.card span{{color:#1B6B47}}section{{margin-top:40px}}</style></head><body><main><h1>Apollo media kit</h1><p>Faithful static design exports generated from the current React Native source without browser automation. The current app maps dark preference to the same Light Sentinel palette, so light and dark export pairs intentionally match.</p><p><a href='apollo-media-kit.zip'>Download the complete ZIP</a> · <a href='manifest.json'>Manifest</a></p>{''.join(sections)}</main></body></html>"""


def main():
    if OUT.exists(): shutil.rmtree(OUT)
    SCREENS.mkdir(parents=True); MASCOTS.mkdir(parents=True); DEMOS.mkdir(parents=True)
    entries=[]
    for name,builder in SCREEN_BUILDERS.items():
        for device,size in DEVICES.items():
            for theme in ("light","dark"):
                filename=f"{name}-{device}-{theme}.png"; builder(size).save(SCREENS/filename,optimize=True)
                entries.append({"group":"Screen captures","label":f"{name.replace('-',' ').title()} · {device.title()} · {theme.title()}","path":f"screens/{filename}","width":size[0],"height":size[1]})
    specs=[("resting","patrolling",None),("sniffing-loading","sniffing",None),("growling-warning","growling",None),("barking-danger","barking",None),("biting-blocked","barking","blocked"),("success","patrolling","success")]
    for state,source,overlay in specs:
        save_transparent_gif(state,source,overlay); entries.append({"group":"Transparent Apollo loops","label":state.replace('-',' ').title(),"path":f"gifs/transparent/apollo-{state}.gif"})
    demos=[("resting","patrolling",PALETTE["green"],"Protected","Apollo is resting within the checks he can currently see.",None),("sniffing-loading","sniffing",PALETTE["unknown"],"Apollo is checking","The result is not ready yet.",None),("growling-warning","growling",PALETTE["amber"],"Needs your attention","Apollo found something that needs a careful check.",None),("barking-danger","barking",PALETTE["red"],"Threat warning","Stop and review the evidence before continuing.",None),("biting-blocked","barking",PALETTE["red"],"Threat stopped","Apollo confirmed and stopped this threat within the shown scope.","blocked"),("success","patrolling",PALETTE["green"],"All clear","The check completed with no known threat found.","success")]
    for args in demos:
        state_demo(*args); entries.append({"group":"Full-screen state demonstrations","label":args[0].replace('-',' ').title(),"path":f"gifs/full-screen/apollo-{args[0]}-ui-demo.gif"})
    (OUT/"manifest.json").write_text(json.dumps({"generatedFrom":"Apollo current source","darkThemeNote":"Current dark preference uses the Light Sentinel palette.","assets":entries},indent=2),encoding="utf-8")
    (OUT/"index.html").write_text(gallery(entries),encoding="utf-8")
    print(json.dumps({"screens":28,"transparentGifs":6,"fullScreenGifs":6,"output":str(OUT)}))


if __name__ == "__main__": main()