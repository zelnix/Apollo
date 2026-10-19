"""Make an Apollo state GIF's white backdrop transparent (flood-fill from the edges so white highlights inside the
shield are kept). Rebuilds every frame fully composited so disposal quirks don't leave ghosts.
Usage: python3 scripts/gif-transparent.py assets/images/apollo-growling.gif [more.gif ...]
"""
import sys
from collections import deque

from PIL import Image

NEAR_WHITE = 228  # every channel >= this counts as backdrop


def clear_backdrop(frame: Image.Image) -> Image.Image:
    fr = frame.convert("RGBA")
    w, h = fr.size
    px = fr.load()
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y * w + x]:
            continue
        seen[y * w + x] = 1
        r, g, b, a = px[x, y]
        if a == 0 or (r >= NEAR_WHITE and g >= NEAR_WHITE and b >= NEAR_WHITE):
            px[x, y] = (0, 0, 0, 0)
            q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return fr


def to_palette(fr: Image.Image) -> Image.Image:
    alpha = fr.getchannel("A")
    p = fr.convert("RGB").quantize(colors=255, method=Image.Quantize.FASTOCTREE)
    mask = alpha.point(lambda a: 255 if a < 128 else 0)
    p.paste(255, mask=mask)
    p.info["transparency"] = 255
    return p


def main(path: str) -> None:
    src = Image.open(path)
    frames, durations = [], []
    for i in range(getattr(src, "n_frames", 1)):
        src.seek(i)
        durations.append(src.info.get("duration", 100))
        frames.append(to_palette(clear_backdrop(src)))
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durations, loop=0, disposal=2, transparency=255, optimize=False)
    print(f"{path}: {len(frames)} frames, transparent backdrop")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        main(p)
