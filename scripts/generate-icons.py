#!/usr/bin/env python3
"""
Genera le icone PNG della PWA senza dipendenze esterne (solo stdlib).

L'icona riprende il logo della PWA: sfondo scuro con angoli arrotondati e
traccia audio in azzurro. Il rendering usa funzioni di distanza con firma
(SDF) e supersampling 3x per l'antialiasing.

Uso:  python3 scripts/generate-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

BG = (0x0B, 0x11, 0x20)        # #0b1120
ACCENT = (0x38, 0xBD, 0xF8)    # #38bdf8
SS = 3                          # fattore di supersampling

OUT = Path(__file__).resolve().parent.parent / "icons"

# Traccia audio (coordinate 0..1), stessa forma del logo SVG nell'HTML.
WAVE = [
    (0.08, 0.50), (0.17, 0.50), (0.25, 0.22), (0.37, 0.78),
    (0.50, 0.34), (0.58, 0.62), (0.66, 0.44), (0.75, 0.50),
    (0.92, 0.50),
]


def rounded_rect_sdf(x, y, half_w, half_h, radius):
    """Distanza con firma da un rettangolo con angoli arrotondati."""
    dx = abs(x) - (half_w - radius)
    dy = abs(y) - (half_h - radius)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return outside + inside - radius


def segment_sdf(px, py, ax, ay, bx, by):
    """Distanza con firma da un segmento."""
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length2 = vx * vx + vy * vy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / length2))
    return math.hypot(wx - t * vx, wy - t * vy)


def wave_sdf(x, y, points, width):
    half = width / 2.0
    return min(segment_sdf(x, y, *a, *b) for a, b in zip(points, points[1:])) - half


def render(size, maskable=False):
    """Restituisce i pixel RGBA dell'icona, con antialiasing."""
    # Per le icone maskable il sistema puo ritagliare fino al 20% per lato:
    # la forma deve quindi stare nella "safe zone" centrale.
    padding = 0.0 if maskable else 0.04
    corner = 0.0 if maskable else 0.22
    half = 0.5 - padding

    # Centrare i punti: le SDF del rettangolo e della traccia lavorano
    # entrambe in coordinate relative al centro (-0.5, 0.5).
    scale = 0.62 if maskable else 0.88
    wave_points = [(0.5 + (px - 0.5) * scale, 0.5 + (py - 0.5) * scale) for px, py in WAVE]
    wave_width = 0.075 if maskable else 0.055

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = (x + (sx + 0.5) / SS) / size
                    py = (y + (sy + 0.5) / SS) / size

                    if maskable:
                        # Sfondo pieno: il ritaglio circolare non deve
                        # lasciare mai bordi trasparenti.
                        color, alpha = BG, 255
                    else:
                        d = rounded_rect_sdf(px - 0.5, py - 0.5, half, half, corner)
                        if d > 0:
                            continue
                        color, alpha = BG, 255

                    # La traccia lavora in coordinate 0..1, come WAVE.
                    if wave_sdf(px, py, wave_points, wave_width) <= 0:
                        color = ACCENT

                    r += color[0]
                    g += color[1]
                    b += color[2]
                    a += alpha

            samples = SS * SS
            if a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                covered = a / 255
                row += bytes((round(r / covered), round(g / covered), round(b / covered), round(a / samples)))
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    height = len(rows)
    width = len(rows[0]) // 4

    raw = b"".join(b"\x00" + row for row in rows)  # filtro 0 per riga

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)
    return len(png)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    targets = [
        ("favicon.png", 64, False),
        ("apple-touch-icon.png", 180, False),
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ]
    for name, size, maskable in targets:
        rows = render(size, maskable)
        written = write_png(OUT / name, rows)
        print(f"{name:26} {size}x{size} {'maskable' if maskable else '       '} {written:,} byte")


if __name__ == "__main__":
    main()
