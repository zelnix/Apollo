#!/usr/bin/env python3
"""Prepare the user-supplied Apollo artwork for native and in-app icon surfaces."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "assets" / "images"
SOURCE = IMAGES / "logo-source.png"
APP_BACKGROUND = (245, 247, 250, 255)


def transparent_subject(source: Image.Image) -> Image.Image:
    image = source.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, _ = pixels[x, y]
            low, high = min(red, green, blue), max(red, green, blue)
            chroma = high - low
            if low >= 238 and chroma <= 16:
                alpha = 0
            elif low >= 220 and chroma <= 24:
                alpha = max(0, min(255, int((238 - low) / 18 * 255)))
            else:
                alpha = 255
            pixels[x, y] = (red, green, blue, alpha)
    bounds = image.getbbox()
    if not bounds:
        raise RuntimeError("Supplied logo contains no visible subject")
    return image.crop(bounds)


def contain(subject: Image.Image, maximum: tuple[int, int]) -> Image.Image:
    scale = min(maximum[0] / subject.width, maximum[1] / subject.height)
    size = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
    return subject.resize(size, Image.Resampling.LANCZOS)


def place(subject: Image.Image, canvas_size: int, maximum: tuple[int, int], background) -> Image.Image:
    canvas = Image.new("RGBA", (canvas_size, canvas_size), background)
    mark = contain(subject, maximum)
    canvas.alpha_composite(mark, ((canvas_size - mark.width) // 2, (canvas_size - mark.height) // 2))
    return canvas


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Missing supplied artwork: {SOURCE}")
    source = Image.open(SOURCE)
    if source.width != source.height or source.width < 1024:
        raise ValueError("Apollo source artwork must be square and at least 1024px")
    subject = transparent_subject(source)

    # iOS and legacy Android icon: opaque; the operating system applies its own mask.
    place(subject, 1024, (820, 900), APP_BACKGROUND).convert("RGB").save(IMAGES / "icon.png", optimize=True)
    # Android adaptive foreground: keep the complete shield inside the mask-safe centre.
    place(subject, 1024, (650, 720), (0, 0, 0, 0)).save(IMAGES / "adaptive-icon.png", optimize=True)
    # In-app brand mark and favicon retain transparency for flexible surfaces.
    place(subject, 512, (430, 470), (0, 0, 0, 0)).save(IMAGES / "logo.png", optimize=True)
    place(subject, 64, (54, 58), (0, 0, 0, 0)).save(IMAGES / "favicon.png", optimize=True)
    print({"source": source.size, "subject": subject.size, "icon": (1024, 1024), "logo": (512, 512), "favicon": (64, 64)})


if __name__ == "__main__":
    main()