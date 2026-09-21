# Genera build/icon.png (256x256) sin dependencias: fondo oscuro redondeado + panal amarillo.
import math, struct, zlib, os

W = H = 256
BG = (15, 17, 21); YEL = (245, 183, 0); DARK = (26, 20, 0)

def inside_hex(px, py, cx, cy, r):
    # hexágono de lado plano arriba: ancho 2r, alto r*sqrt(3)
    dx, dy = abs(px - cx), abs(py - cy)
    return dy <= r * math.sqrt(3) / 2 and dx <= r - dy / math.sqrt(3)

def rounded(px, py, rad=48):
    x = min(px, W - 1 - px); y = min(py, H - 1 - py)
    if x >= rad or y >= rad: return True
    return (x - rad) ** 2 + (y - rad) ** 2 <= rad ** 2

hexes = []
r = 34
for row in range(-1, 2):
    for col in range(-1, 2):
        cx = 128 + col * r * 1.8 + (row % 2) * r * 0.9
        cy = 128 + row * r * 1.56
        hexes.append((cx, cy))

rows = []
for y in range(H):
    line = bytearray([0])
    for x in range(W):
        if not rounded(x, y):
            line += bytes([0, 0, 0, 0]); continue
        col = BG
        for (cx, cy) in hexes:
            if inside_hex(x, y, cx, cy, r - 3):
                col = YEL
                if inside_hex(x, y, cx, cy, r - 12): col = DARK
                if (cx, cy) == hexes[4] and inside_hex(x, y, cx, cy, r - 12): col = YEL
                break
        line += bytes([*col, 255])
    rows.append(bytes(line))

raw = b"".join(rows)
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
os.makedirs(os.path.dirname(os.path.abspath(__file__)), exist_ok=True)
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png"), "wb").write(png)
print("icon.png generado")
