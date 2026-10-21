"""가짜 AI: API 키 없이 Tag Lab 화면과 계산이 제대로 도는지 확인할 때만 써요. 결과는 의미 없어요."""
import hashlib, json, random, re

FIELDS = ["video", "ai_image", "3d", "graphic", "editorial", "photo", "ui_ux", "spatial"]


def fake_answer(prompt, b64):
    h = int(hashlib.md5(b64[:5000].encode()).hexdigest(), 16)
    rnd = random.Random()
    listed = re.findall(r"(?:^|; |\] )([a-z0-9][a-z0-9-]+)(?: \(|;|$)", prompt, re.M)
    pool = listed or ["minimal", "soft-light", "chrome", "pastel", "grain", "bold-type", "monochrome", "organic"]
    base = random.Random(h).sample(pool, min(6, len(pool)))
    tags = [t for t in base if rnd.random() > 0.12] + ([rnd.choice(pool)] if rnd.random() < 0.3 else [])
    m = re.search(r'exactly one of (\[.*?\])', prompt)
    fields = json.loads(m.group(1)) if m else FIELDS
    field = fields[h % len(fields)] if rnd.random() > 0.15 else rnd.choice(fields)
    group = random.Random(h).choice(["soft chrome", "quiet grids", "bold posters", "warm interiors"])
    if rnd.random() < 0.2:
        group += " study"
    return json.dumps({"field": field, "tags": tags or base[:3], "group_name": group}), 380 + h % 40, 55
