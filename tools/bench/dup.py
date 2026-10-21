#!/usr/bin/env python3
"""
Axia Test 4 · 중복률 측정 (게시물 단위 + 이미지 단위)

두 사람이 확장 프로그램 결과 페이지에서 'JSON 내보내기'로 받은 파일을 비교해서
같은 레퍼런스가 얼마나 겹치는지 셉니다.

실행:  python dup.py data/하람.json data/부근.json
       (Mac은 python3)

- 1단계: 게시물 주소가 같은 것 = 확실한 중복 (인터넷 필요 없음)
- 2단계: 주소는 다르지만 썸네일이 같은 이미지 (pHash 거리 8 이하)
         썸네일을 내려받아 비교해요. 썸네일 주소는 수집 후 약 4일 뒤 만료되니 그 전에 실행하세요.

필요한 것
- Windows: Python 3 + Pillow 한 개 (약 10MB):  pip install pillow
- Mac: 설치 없이 동작 (Mac 기본 도구 sips 사용). Pillow가 있으면 그걸 씀
"""
import concurrent.futures as cf
import io, json, math, os, shutil, struct, subprocess, sys, tempfile, time, urllib.request

try:
    from PIL import Image
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False
HAVE_SIPS = shutil.which("sips") is not None

N = 32  # pHash: 32x32 grayscale → DCT → top-left 8x8
COS = [[math.cos(math.pi * (2 * x + 1) * u / (2 * N)) for x in range(N)] for u in range(8)]


def load(path):
    d = json.load(open(path, encoding="utf-8"))
    items = d.get("items", d)
    if isinstance(items, dict):
        items = list(items.values())
    return {i["shortcode"]: i for i in items if isinstance(i, dict) and i.get("shortcode")}


def gray32_pil(data):
    im = Image.open(io.BytesIO(data)).convert("L").resize((N, N), Image.LANCZOS)
    px = list(im.getdata())
    return [px[r * N:(r + 1) * N] for r in range(N)]


def gray32_sips(data, tmp):
    src = os.path.join(tmp, f"{os.getpid()}_{time.time_ns()}.jpg")
    out = src[:-4] + ".bmp"
    open(src, "wb").write(data)
    try:
        subprocess.run(["sips", "-s", "format", "bmp", "-z", str(N), str(N), src, "--out", out],
                       capture_output=True, check=True)
        b = open(out, "rb").read()
    finally:
        for f in (src, out):
            try: os.remove(f)
            except OSError: pass
    off = struct.unpack_from("<I", b, 10)[0]
    w, h = struct.unpack_from("<ii", b, 18)
    bpp = struct.unpack_from("<H", b, 28)[0] // 8
    stride = (w * bpp + 3) & ~3
    rows = []
    for y in range(abs(h)):
        ry = (abs(h) - 1 - y) if h > 0 else y
        base = off + ry * stride
        row = []
        for x in range(w):
            bl, g, r = b[base + x * bpp], b[base + x * bpp + 1], b[base + x * bpp + 2]
            row.append(0.299 * r + 0.587 * g + 0.114 * bl)
        rows.append(row)
    return rows


def phash(gray):
    # separable 2D DCT, keep the 8x8 low-frequency block
    tmp = [[sum(COS[u][x] * gray[y][x] for x in range(N)) for u in range(8)] for y in range(N)]
    low = [[sum(COS[v][y] * tmp[y][u] for y in range(N)) for u in range(8)] for v in range(8)]
    flat = [c for row in low for c in row]
    med = sorted(flat)[len(flat) // 2]
    bits = 0
    for c in flat:
        bits = (bits << 1) | (1 if c > med else 0)
    return bits


def fetch_hash(url, tmp):
    try:
        req = urllib.request.Request(url, headers={"user-agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        gray = gray32_pil(data) if HAVE_PIL else gray32_sips(data, tmp)
        return phash(gray)
    except Exception:
        return None


def hashes(items, label):
    todo = [(k, v["thumbUrl"]) for k, v in items.items() if v.get("thumbUrl")]
    out, done = {}, 0
    tmp = tempfile.mkdtemp(prefix="axia-dup-")
    try:
        with cf.ThreadPoolExecutor(8) as ex:
            for (k, _), h in zip(todo, ex.map(lambda kv: fetch_hash(kv[1], tmp), todo)):
                done += 1
                if h is not None:
                    out[k] = h
                if done % 200 == 0 or done == len(todo):
                    print(f"  {label}: {done}/{len(todo)} (성공 {len(out)})", flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


def main():
    if len(sys.argv) != 3:
        sys.exit("사용법: python dup.py A.json B.json")
    A, B = load(sys.argv[1]), load(sys.argv[2])
    same = set(A) & set(B)
    print(f"A {len(A)}개, B {len(B)}개 → 게시물 주소가 같은 것 {len(same)}개")
    res = {"A": len(A), "B": len(B), "same_post": len(same),
           "same_post_rate_of_B": round(len(same) / max(1, len(B)), 4)}

    if not HAVE_PIL and not HAVE_SIPS:
        print("\n이미지 비교(2단계)는 건너뜀: Pillow가 필요해요 →  pip install pillow  후 다시 실행")
    else:
        print(f"\n썸네일을 내려받아 비교해요 ({'Pillow' if HAVE_PIL else 'Mac sips'} 사용). 몇 분 걸려요.")
        ha = hashes({k: v for k, v in A.items() if k not in same}, "A")
        hb = hashes({k: v for k, v in B.items() if k not in same}, "B")
        print("  이미지끼리 비교 중... (수십 초)", flush=True)
        blist = list(hb.items())
        near, used = [], set()
        for ka, h in ha.items():
            for kb, hb2 in blist:
                if kb not in used and bin(h ^ hb2).count("1") <= 8:
                    near.append((ka, kb)); used.add(kb); break
        expired = (len(A) - len(same) - len(ha)) + (len(B) - len(same) - len(hb))
        res.update({
            "same_image_different_post": len(near),
            "hash_ok_A": len(ha), "hash_ok_B": len(hb), "hash_failed_or_expired": expired,
            "total_dup_rate_of_B": round((len(same) + len(near)) / max(1, len(B)), 4),
            "examples": [f"https://www.instagram.com/p/{a}/ ↔ https://www.instagram.com/p/{b}/" for a, b in near[:10]],
        })
        if len(ha) + len(hb) < 0.5 * (len(A) + len(B) - 2 * len(same)):
            print("⚠ 절반 이상 못 내려받았어요. 썸네일 주소가 만료됐을 수 있어요(수집 후 약 4일).")

    print(json.dumps(res, ensure_ascii=False, indent=2))
    json.dump(res, open("dup_result.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("\n→ dup_result.json 에 저장했어요. 이 파일을 Claude에게 보내 주세요.")


if __name__ == "__main__":
    main()
