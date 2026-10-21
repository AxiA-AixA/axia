"""
Axia 태깅 엔진 (서비스에 그대로 옮겨 쓰는 부분)

이 파일 하나가 "이미지 한 장 → 분야·태그·그룹 이름"을 담당해요.
Tag Lab(lab.py)은 이 엔진을 시험하는 작업대이고, 실제 서비스 서버도 이 파일의
tag_image() 를 그대로 부르면 돼요. 외부 라이브러리 없이 동작해요(Pillow가 있으면 이미지 축소에 씀).

입력  : 이미지 바이트, Court(태그 규칙집), 모델 설정
출력  : {"field": "3d", "tags": [...], "group_name": "...", "dropped": [...], "in_tokens": n, "out_tokens": n, "latency_ms": n}

Court = 팀이 합의한 태그 규칙집(JSON). 태그마다 뜻(def)을 적어 두면 AI가 그 뜻대로 고르고,
목록에 없는 태그는 엔진이 걸러내요(dropped). 이게 "같은 이미지는 언제나 같은 태그"를 지키는 장치예요.
"""
import base64, io, json, os, re, shutil, subprocess, tempfile, time, urllib.error, urllib.request

FIELDS = {  # 폴더 이름(한국어) → 내부 코드
    "영상": "video", "AI이미지": "ai_image", "3D": "3d", "그래픽": "graphic",
    "편집디자인": "editorial", "사진": "photo", "UIUX": "ui_ux", "공간전시": "spatial",
}
FIELD_DEFS = {
    "video": "still from film / motion / animation",
    "ai_image": "image made with a generative AI model",
    "3d": "CG render or 3D artwork",
    "graphic": "graphic design: branding, posters, flat or vector illustration, 2D compositions",
    "editorial": "editorial / book / magazine / layout design",
    "photo": "camera photograph (fashion, product, portrait, landscape)",
    "ui_ux": "app screen, website, interface",
    "spatial": "interior, retail, exhibition, stage or set design",
    "typography": "work where lettering / type is the main subject (type specimens, lettering, type-led posters)",
    "painting": "painting or drawing made by hand or digitally in a painterly way (oil, watercolour, gouache, sketch)",
    "package": "packaging design: boxes, bottles, labels, bags",
}


def field_code(folder_name):
    """폴더 이름 → 분야 코드. 한국어 폴더 이름(영상, 3D…)과 영어 폴더 이름(3d, Typography…) 모두 받아요."""
    import unicodedata
    n = unicodedata.normalize("NFC", folder_name).strip()
    if n.replace(" ", "") in FIELDS:
        return FIELDS[n.replace(" ", "")]
    return re.sub(r"[\s-]+", "_", n.lower())

PRICES = {  # USD per 1M tokens (input, output), 2026-10 기준. 바뀌면 여기만 고치면 돼요.
    "claude-haiku-5-5": (0.10, 0.50), "claude-sonnet-5-5": (2.0, 10.0),
    "gemini-3.1-flash-lite": (0.25, 1.50), "gemini-3.5-flash-lite": (0.30, 2.50),
    "gpt-5.4-nano": (0.20, 1.25),
}


# ---------- Court (태그 규칙집) ----------
def court_from_tags_txt(text):
    """예전 tags.txt('# --- 그룹' 줄 + 태그 줄)를 Court로 바꿔요."""
    tags, group = [], "기타"
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("#"):
            m = re.match(r"#\s*-+\s*(.+)", s)
            if m:
                group = m.group(1).strip()
            continue
        tags.append({"tag": norm_tag(s), "group": group, "def": ""})
    return {"version": 1, "note": "tags.txt에서 시작", "min_tags": 5, "max_tags": 8, "tags": tags}


def norm_tag(t):
    t = str(t).strip().lower().replace("_", "-")
    t = re.sub(r"\s+", "-", t)
    return re.sub(r"-{2,}", "-", t).strip("-")


def court_fields(court):
    return court.get("fields") or FIELD_DEFS


def build_prompt(court, mode="list"):
    fd = court_fields(court)
    fields = "\n".join(f'     {k} = {v}' if v else f'     {k}' for k, v in fd.items())
    lo, hi = court.get("min_tags", 5), court.get("max_tags", 8)
    p = (
        "You are tagging a visual design reference for a reference-organising tool used by designers.\n"
        "Return ONLY a JSON object, no prose, with keys:\n"
        f'  "field": exactly one of {json.dumps(list(fd))}\n{fields}\n'
        f'  "tags": array of {lo} to {hi} lowercase tags\n'
        '  "group_name": a short (1-3 word) English folder name this image would belong to\n'
    )
    if mode == "free":
        return p + ("Tags must be precise design vocabulary (form, material, light, colour, typography, mood), "
                    "hyphenated, not generic words like 'design' or 'image'.\n")
    lines = []
    for g in _groups(court):
        items = [f"{t['tag']}" + (f" ({t['def']})" if t.get("def") else "") for t in court["tags"] if t.get("group") == g]
        lines.append(f"[{g}] " + "; ".join(items))
    p += "Choose tags ONLY from this list and copy them exactly. Pick only tags that are clearly visible; a definition in brackets is binding.\n"
    p += "\n".join(lines) + "\n"
    if court.get("rules"):
        p += "Rules:\n" + "\n".join(f"- {r}" for r in court["rules"]) + "\n"
    return p


def _groups(court):
    seen = []
    for t in court["tags"]:
        if t.get("group") not in seen:
            seen.append(t.get("group"))
    return seen


# ---------- 이미지 준비 ----------
def shrink(data, size=512):
    """긴 변을 size px 이하 JPEG로 줄여요. Pillow → macOS sips → 원본 순서로 시도."""
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((size, size))
        out = io.BytesIO()
        im.save(out, "JPEG", quality=88)
        return out.getvalue(), "image/jpeg"
    except Exception:
        pass
    if shutil.which("sips"):
        d = tempfile.mkdtemp(prefix="axia-")
        try:
            src, dst = os.path.join(d, "in"), os.path.join(d, "out.jpg")
            open(src, "wb").write(data)
            r = subprocess.run(["sips", "-Z", str(size), "-s", "format", "jpeg", src, "--out", dst], capture_output=True)
            if r.returncode == 0 and os.path.exists(dst):
                return open(dst, "rb").read(), "image/jpeg"
        finally:
            shutil.rmtree(d, ignore_errors=True)
    mime = "image/png" if data[:4] == b"\x89PNG" else "image/webp" if data[8:12] == b"WEBP" else "image/jpeg"
    return data, mime


# ---------- 모델 호출 ----------
def _post(url, headers, body, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def call_model(provider, model, key, prompt, b64, mime):
    if provider == "anthropic":
        d = _post("https://api.anthropic.com/v1/messages", {"x-api-key": key, "anthropic-version": "2023-06-01"},
                  {"model": model, "max_tokens": 400, "temperature": 0,
                   "messages": [{"role": "user", "content": [
                       {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
                       {"type": "text", "text": prompt}]}]})
        u = d.get("usage", {})
        return "".join(c.get("text", "") for c in d.get("content", [])), u.get("input_tokens"), u.get("output_tokens")
    if provider == "gemini":
        d = _post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", {"x-goog-api-key": key},
                  {"contents": [{"parts": [{"inline_data": {"mime_type": mime, "data": b64}}, {"text": prompt}]}],
                   "generationConfig": {"temperature": 0, "maxOutputTokens": 400, "responseMimeType": "application/json"}})
        u = d.get("usageMetadata", {})
        text = "".join(p.get("text", "") for c in d.get("candidates", []) for p in c.get("content", {}).get("parts", []))
        return text, u.get("promptTokenCount"), u.get("candidatesTokenCount")
    if provider == "openai":
        d = _post("https://api.openai.com/v1/responses", {"authorization": "Bearer " + key},
                  {"model": model, "max_output_tokens": 400,
                   "input": [{"role": "user", "content": [
                       {"type": "input_text", "text": prompt},
                       {"type": "input_image", "image_url": f"data:{mime};base64,{b64}", "detail": "low"}]}]})
        u = d.get("usage", {})
        text = "".join(c.get("text", "") for o in d.get("output", []) for c in (o.get("content") or []) if c.get("type") == "output_text")
        return text, u.get("input_tokens"), u.get("output_tokens")
    if provider == "mock":  # 키 없이 화면·지표를 시험할 때 쓰는 가짜 AI
        from mock_model import fake_answer
        return fake_answer(prompt, b64)
    raise ValueError(f"unknown provider {provider}")


def parse_json(text):
    t = (text or "").strip()
    s, e = t.find("{"), t.rfind("}")
    if s < 0 or e < 0:
        return None
    try:
        return json.loads(t[s:e + 1])
    except Exception:
        return None


def clean(answer, court, mode):
    """모델 답을 Court 기준으로 정리: 소문자·하이픈 통일, 중복 제거, 목록 방식이면 목록 밖 태그 제거."""
    allowed = {t["tag"] for t in court["tags"]}
    tags, dropped = [], []
    for t in (answer.get("tags") or []):
        n = norm_tag(t)
        if not n or n in tags:
            continue
        if mode == "list" and n not in allowed:
            dropped.append(n)
            continue
        tags.append(n)
    field = str(answer.get("field") or "").strip().lower()
    return {"field": field if field in court_fields(court) else None,
            "tags": tags[: court.get("max_tags", 8)],
            "group_name": str(answer.get("group_name") or "").strip().lower(),
            "dropped": dropped}


def tag_image(data, court, provider, model, key, mode="list", size=512, retries=5, on_retry=None, base_wait=10):
    """이미지 한 장을 태깅해요. 서비스에서도 이 함수를 그대로 쓰면 돼요."""
    small, mime = shrink(data, size)
    b64 = base64.b64encode(small).decode()
    prompt = build_prompt(court, mode)
    t0 = time.time()
    for attempt in range(retries + 1):
        try:
            text, tin, tout = call_model(provider, model, key, prompt, b64, mime)
            ans = parse_json(text)
            out = {"latency_ms": int((time.time() - t0) * 1000), "in_tokens": tin, "out_tokens": tout, "error": None}
            if ans is None:
                out.update(field=None, tags=[], group_name="", dropped=[], error="JSON 아님: " + (text or "")[:200])
            else:
                out.update(clean(ans, court, mode))
            return out
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="ignore")[:300]
            if e.code in (429, 500, 502, 503, 529) and attempt < retries:
                if on_retry:
                    on_retry(f"HTTP {e.code} → {min(60, base_wait * (attempt + 1))}초 기다렸다 다시 ({attempt + 1}/{retries}): {body[:160]}")
                time.sleep(min(60, base_wait * (attempt + 1)))  # 무료 등급의 분당 한도에 걸리면 기다렸다 다시
                continue
            return {"latency_ms": int((time.time() - t0) * 1000), "error": f"HTTP {e.code}: {body}"}
        except Exception as e:
            if attempt < retries:
                time.sleep(2)
                continue
            return {"latency_ms": int((time.time() - t0) * 1000), "error": str(e)[:300]}


BUSY = ("HTTP 429", "HTTP 500", "HTTP 502", "HTTP 503", "HTTP 529", "HTTP 404")


def tag_with_fallback(data, court, chain, keys, mode="list", size=512, on_retry=None):
    """대체 순서(chain)대로 시도해요. 앞 모델이 붐비거나(503·429) 없어졌으면(404) 다음 모델로 넘어가요.
    chain = [{"provider": "gemini", "model": "gemini-3.5-flash-lite"}, {"provider": "anthropic", "model": "claude-haiku-5-5"}, ...]
    키가 없는 회사는 건너뛰어요."""
    last = {"error": "사용할 수 있는 모델이 없어요. 설정에서 API 키를 넣어 주세요."}
    for step in chain:
        prov, model = step.get("provider"), step.get("model")
        key = keys.get(prov, "")
        if prov != "mock" and not key:
            continue
        res = tag_image(data, court, prov, model, key, mode=mode, size=size, retries=2, on_retry=on_retry, base_wait=5)
        res.update(provider=prov, model=model)
        if not res.get("error"):
            return res
        last = res
        if not str(res["error"]).startswith(BUSY):
            return res  # 붐빔이 아닌 오류(키 틀림 등)는 다음 모델로 넘겨도 소용없어서 바로 알려요
        if on_retry:
            on_retry(f"{model} 붐빔 → 다음 모델로")
    return last


def cost_usd(model, in_tokens, out_tokens):
    p = PRICES.get(model)
    if not p:
        return None
    return (in_tokens or 0) / 1e6 * p[0] + (out_tokens or 0) / 1e6 * p[1]
