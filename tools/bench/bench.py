#!/usr/bin/env python3
"""
Axia Test 3 + Test 4 측정 스크립트 (추가 설치 없이 Mac 기본 Python으로 실행)

하는 일
  - axia-test3 폴더의 이미지를 AI 모델에 보내 분야·태그·그룹 이름을 받아요 (Test 3)
  - 장당 걸린 시간, 실제 입력·출력 토큰을 기록해요 (Test 4)
  - 결과는 results/ 폴더에 jsonl 파일로 쌓여요. 그 파일을 Claude에게 주면 일치율·정확도를 계산해요.

사용 예
  python3 bench.py --dry-run
  ANTHROPIC_API_KEY=... python3 bench.py --provider anthropic --model claude-haiku-5-5 --runs 3 --mode both
  GEMINI_API_KEY=...    python3 bench.py --provider gemini    --model gemini-2.5-flash-lite --runs 3 --mode both
  OPENAI_API_KEY=...    python3 bench.py --provider openai    --model gpt-5.4-nano --runs 3 --mode both
"""
import argparse, base64, unicodedata, concurrent.futures as cf, json, os, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIELDS = {"영상": "video", "AI이미지": "ai_image", "3D": "3d", "그래픽": "graphic", "편집디자인": "editorial",
          "사진": "photo", "UIUX": "ui_ux", "공간전시": "spatial"}
EXTS = {".jpg", ".jpeg", ".png", ".webp"}

BASE = (
    "You are tagging a visual design reference for a reference-organising tool used by designers.\n"
    "Return ONLY a JSON object, no prose, with keys:\n"
    '  "field": exactly one of ["video","ai_image","3d","graphic","editorial","photo","ui_ux","spatial"]\n'
    '     video = still from film / motion / animation; ai_image = image made with a generative AI model;\n'
    '     3d = CG render or 3D artwork; graphic = graphic design, illustration, branding, poster-like 2D;\n'
    '     editorial = editorial / book / magazine / layout design; photo = camera photograph (fashion, product, portrait);\n'
    '     ui_ux = app screen, website, interface; spatial = interior, retail, exhibition, stage or set design\n'
    '  "tags": array of 5 to 8 lowercase tags\n'
    '  "group_name": a short (1-3 word) folder name this image would belong to\n'
)
FREE = BASE + "Tags must be precise design vocabulary (form, material, light, colour, typography, mood), hyphenated, not generic words like 'design' or 'image'.\n"


def list_prompt(tags):
    return BASE + "Choose tags ONLY from this list, copy them exactly:\n" + ", ".join(tags) + "\n"


def load_tags():
    return [l.strip() for l in (HERE / "tags.txt").read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]


def find_images(root):
    items = []
    for folder in sorted(Path(root).iterdir()):
        if not folder.is_dir():
            continue
        name = unicodedata.normalize("NFC", folder.name)  # Mac Finder may store Korean names decomposed (NFD)
        truth = FIELDS.get(name.replace(" ", ""))
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() in EXTS:
                items.append((f, name, truth))
    return items


def resize(src, size, tmpdir):
    """Make a <=size px JPEG copy (Pillow if installed, else macOS 'sips'). Falls back to the original file."""
    out = Path(tmpdir) / (src.stem + f"_{size}.jpg")
    try:
        from PIL import Image
        im = Image.open(src).convert("RGB")
        im.thumbnail((size, size))
        im.save(out, "JPEG", quality=88)
        return out, "image/jpeg"
    except Exception:
        pass
    if shutil.which("sips"):
        r = subprocess.run(["sips", "-Z", str(size), "-s", "format", "jpeg", str(src), "--out", str(out)], capture_output=True)
        if r.returncode == 0 and out.exists():
            return out, "image/jpeg"
    mime = {".png": "image/png", ".webp": "image/webp"}.get(src.suffix.lower(), "image/jpeg")
    return src, mime


def post(url, headers, body, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def call(provider, model, prompt, b64, mime):
    if provider == "anthropic":
        d = post("https://api.anthropic.com/v1/messages",
                 {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"},
                 {"model": model, "max_tokens": 400, "temperature": 0,
                  "messages": [{"role": "user", "content": [
                      {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
                      {"type": "text", "text": prompt}]}]})
        text = "".join(c.get("text", "") for c in d.get("content", []))
        u = d.get("usage", {})
        return text, u.get("input_tokens"), u.get("output_tokens")
    if provider == "gemini":
        key = os.environ["GEMINI_API_KEY"]
        d = post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}", {},
                 {"contents": [{"parts": [{"inline_data": {"mime_type": mime, "data": b64}}, {"text": prompt}]}],
                  "generationConfig": {"temperature": 0, "maxOutputTokens": 400, "responseMimeType": "application/json"}})
        text = "".join(p.get("text", "") for c in d.get("candidates", []) for p in c.get("content", {}).get("parts", []))
        u = d.get("usageMetadata", {})
        return text, u.get("promptTokenCount"), u.get("candidatesTokenCount")
    if provider == "openai":
        d = post("https://api.openai.com/v1/responses", {"authorization": "Bearer " + os.environ["OPENAI_API_KEY"]},
                 {"model": model, "max_output_tokens": 400,
                  "input": [{"role": "user", "content": [
                      {"type": "input_text", "text": prompt},
                      {"type": "input_image", "image_url": f"data:{mime};base64,{b64}", "detail": "low"}]}]})
        text = "".join(c.get("text", "") for o in d.get("output", []) for c in (o.get("content") or []) if c.get("type") == "output_text")
        u = d.get("usage", {})
        return text, u.get("input_tokens"), u.get("output_tokens")
    raise ValueError(provider)


def parse(text):
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`").split("\n", 1)[-1]
    s, e = t.find("{"), t.rfind("}")
    try:
        return json.loads(t[s:e + 1])
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", default=str(HERE.parent / "axia-test3") if (HERE.parent / "axia-test3").exists() else str(Path.home() / "Downloads" / "axia-test3"))
    ap.add_argument("--provider", choices=["anthropic", "gemini", "openai"], default="anthropic")
    ap.add_argument("--model", default="claude-haiku-5-5")
    ap.add_argument("--runs", type=int, default=3, help="같은 이미지를 몇 번 반복 분석할지 (일관성 측정)")
    ap.add_argument("--mode", choices=["free", "list", "both"], default="both", help="free=자유 태그, list=태그 목록에서 고르기")
    ap.add_argument("--size", type=int, default=512, help="AI에 보낼 이미지 긴 변(px)")
    ap.add_argument("--workers", type=int, default=4, help="동시에 보낼 요청 수")
    ap.add_argument("--limit", type=int, default=0, help="앞에서 N장만 (시험용)")
    ap.add_argument("--dry-run", action="store_true", help="API 호출 없이 폴더·이미지만 점검")
    a = ap.parse_args()

    items = find_images(a.images)
    if a.limit:
        items = items[:a.limit]
    if not items:
        sys.exit(f"이미지를 못 찾았어요: {a.images}\n하위 폴더(영상, AI이미지, 3D, 그래픽, 편집디자인, 사진, UIUX, 공간전시)에 jpg/png/webp를 넣어 주세요.")
    by = {}
    for _, f, t in items:
        by[f] = by.get(f, 0) + 1
    print("폴더별 장수:", by)
    unknown = [f for f in by if FIELDS.get(f.replace(" ", "")) is None]
    if unknown:
        print("⚠ 정답 분야로 인식 못 한 폴더:", unknown, "→ 폴더 이름을", list(FIELDS), "중 하나로 바꿔 주세요")

    tmp = tempfile.mkdtemp(prefix="axia-")
    prepared = []
    for f, folder, truth in items:
        p, mime = resize(f, a.size, tmp)
        prepared.append((f, folder, truth, base64.b64encode(p.read_bytes()).decode(), mime, p.stat().st_size))
    print(f"{len(prepared)}장 준비 완료 (평균 {sum(x[5] for x in prepared) // len(prepared) // 1024} KB, 긴 변 {a.size}px)")
    if a.dry_run:
        print("dry-run: API는 호출하지 않았어요. 위 장수가 맞으면 --dry-run 없이 실행하세요.")
        return

    env = {"anthropic": "ANTHROPIC_API_KEY", "gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY"}[a.provider]
    if not os.environ.get(env):
        import getpass
        key = getpass.getpass(f"{a.provider} API 키를 붙여넣고 Enter (화면에 안 보여요): ").strip()
        if not key:
            sys.exit("API 키가 없어서 멈췄어요.")
        os.environ[env] = key

    tags = load_tags()
    modes = ["free", "list"] if a.mode == "both" else [a.mode]
    prompts = {"free": FREE, "list": list_prompt(tags)}
    outdir = HERE / "results"
    outdir.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = outdir / f"{a.provider}_{a.model}_{stamp}.jsonl"

    jobs = [(m, r, x) for m in modes for r in range(1, a.runs + 1) for x in prepared]
    print(f"{len(jobs)}건 요청 시작 → {out.name}")

    def work(job):
        mode, run, (f, folder, truth, b64, mime, size) = job
        t0 = time.time()
        rec = {"image": f"{folder}/{f.name}", "truth": truth, "mode": mode, "run": run,
               "provider": a.provider, "model": a.model, "size_px": a.size, "bytes": size}
        for attempt in range(3):
            try:
                text, tin, tout = call(a.provider, a.model, prompts[mode], b64, mime)
                j = parse(text)
                rec.update(latency_ms=int((time.time() - t0) * 1000), in_tokens=tin, out_tokens=tout,
                           field=(j or {}).get("field"), tags=(j or {}).get("tags"), group_name=(j or {}).get("group_name"),
                           raw=None if j else text[:500], error=None)
                return rec
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="ignore")[:300]
                if e.code in (429, 500, 502, 503, 529) and attempt < 2:
                    time.sleep(5 * (attempt + 1))
                    continue
                rec.update(latency_ms=int((time.time() - t0) * 1000), error=f"HTTP {e.code}: {body}")
                return rec
            except Exception as e:
                rec.update(latency_ms=int((time.time() - t0) * 1000), error=str(e)[:300])
                return rec

    T0 = time.time()
    done = ok = 0
    with open(out, "w", encoding="utf-8") as fh, cf.ThreadPoolExecutor(a.workers) as ex:
        for rec in ex.map(work, jobs):
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            done += 1
            ok += rec.get("error") is None
            if done % 10 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)} (성공 {ok})")
    wall = time.time() - T0
    recs = [json.loads(l) for l in open(out, encoding="utf-8")]
    good = [r for r in recs if not r.get("error")]
    summary = {
        "provider": a.provider, "model": a.model, "requests": len(recs), "succeeded": len(good),
        "wall_seconds": round(wall, 1), "workers": a.workers,
        "avg_latency_ms": int(sum(r["latency_ms"] for r in good) / max(1, len(good))),
        "avg_in_tokens": round(sum(r["in_tokens"] or 0 for r in good) / max(1, len(good)), 1),
        "avg_out_tokens": round(sum(r["out_tokens"] or 0 for r in good) / max(1, len(good)), 1),
        "images_per_minute": round(len(good) / wall * 60, 1) if wall else None,
        "field_accuracy_quick": round(sum(r.get("field") == r.get("truth") for r in good if r.get("truth")) / max(1, sum(1 for r in good if r.get("truth"))), 3),
    }
    (outdir / (out.stem + "_summary.json")).write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n결과 파일: {out}\n이 폴더(results)를 Claude에게 알려 주시면 일치율·정확도를 계산해요.")


if __name__ == "__main__":
    main()
