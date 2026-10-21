"""확장 프로그램 아이콘(icon16/48/128.png)을 만들어요. 외부 라이브러리 없이 동작해요.
app.py가 처음 켜질 때 아이콘이 없으면 자동으로 불러요 (GitHub에는 그림 파일 대신 이 스크립트를 올려 둠)."""
import struct, zlib
from pathlib import Path


def _png(size, pixels):
    raw = b"".join(b"\x00" + bytes(pixels[y * size * 4:(y + 1) * size * 4]) for y in range(size))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _inside_a(x, y):
    # 0~1 좌표계의 "A": 바깥 삼각형 - 안쪽 삼각형 구멍 + 가로대
    def tri(px, py, a, b, c):
        def s(p1, p2, p3):
            return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
        d1, d2, d3 = s((px, py), a, b), s((px, py), b, c), s((px, py), c, a)
        return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
    outer = tri(x, y, (0.5, 0.18), (0.80, 0.82), (0.20, 0.82))
    hole = tri(x, y, (0.5, 0.40), (0.64, 0.82), (0.36, 0.82))
    return outer and not hole


def icon(size):
    px = []
    r = size * 0.22
    for y in range(size):
        for x in range(size):
            cx, cy = x + 0.5, y + 0.5
            dx = max(r - cx, 0, cx - (size - r))
            dy = max(r - cy, 0, cy - (size - r))
            if dx * dx + dy * dy > r * r:
                px += [0, 0, 0, 0]
            elif _inside_a(cx / size, cy / size):
                px += [255, 255, 255, 255]
            else:
                px += [17, 17, 17, 255]
    return _png(size, px)


def ensure(folder):
    folder = Path(folder)
    for s in (16, 48, 128):
        f = folder / f"icon{s}.png"
        if not f.exists():
            f.write_bytes(icon(s))


if __name__ == "__main__":
    ensure(Path(__file__).resolve().parent / "extension")
    print("아이콘을 만들었어요.")
