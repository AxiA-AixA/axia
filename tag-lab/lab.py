#!/usr/bin/env python3
"""
Axia Tag Lab — AI 태그 시험·검토·기준 다듬기 작업대 (Test 3)

실행:   python3 lab.py            (Windows: python lab.py)
그러면 브라우저에서 http://localhost:8765 이 열려요.

- 추가 설치 없이 동작해요. 데이터는 전부 이 폴더 안에만 저장돼요(lab_data/).
- API 키는 화면에서 입력하면 이 프로그램이 켜져 있는 동안 메모리에만 두고, 파일에 저장하지 않아요.
"""
import argparse, concurrent.futures as cf, itertools, json, mimetypes, os, random, threading, time, unicodedata, urllib.parse, webbrowser
from collections import Counter, defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import axia_tagger as T

HERE = Path(__file__).resolve().parent
DATA = HERE / "lab_data"
COURT_DIR, RUN_DIR = DATA / "court", DATA / "runs"
REVIEWS = DATA / "reviews.json"
EXTS = {".jpg", ".jpeg", ".png", ".webp"}
IMAGES = None  # set in main()
KEYS = {}      # provider -> key (memory only)
SKIP = set()   # folder names to ignore (lowercase)
JOB = {"running": False}
LOCK = threading.Lock()


def nfc(s):
    return unicodedata.normalize("NFC", s)


# ---------- storage ----------
def jload(p, default):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return default


def jsave(p, obj):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(p) + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


def courts():
    out = []
    for f in sorted(COURT_DIR.glob("court_v*.json"), key=lambda f: int(f.stem.split("_v")[1])):
        c = jload(f, None)
        if c:
            out.append(c)
    return out


def court(version):
    return jload(COURT_DIR / f"court_v{int(version)}.json", None)


def ensure_court():
    if courts():
        return
    src = None
    for cand in (HERE / "tags.txt", HERE.parent / "2_측정도구" / "tags.txt", HERE.parent / "axia-bench" / "tags.txt"):
        if cand.exists():
            src = cand
            break
    c = T.court_from_tags_txt(src.read_text(encoding="utf-8")) if src else {"version": 1, "note": "빈 규칙집", "min_tags": 5, "max_tags": 8, "tags": []}
    c["created"] = time.strftime("%Y-%m-%d %H:%M")
    jsave(COURT_DIR / "court_v1.json", c)


def images():
    out = []
    if not IMAGES.exists():
        return out
    for folder in sorted(IMAGES.iterdir()):
        if not folder.is_dir():
            continue
        name = nfc(folder.name)
        if name.lower() in SKIP:
            continue
        truth = T.field_code(name)
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() in EXTS:
                out.append({"id": f"{name}/{nfc(f.name)}", "folder": name, "truth": truth, "path": f})
    return out


def folders():
    if not IMAGES.exists():
        return []
    return [nfc(f.name) for f in sorted(IMAGES.iterdir()) if f.is_dir() and not f.name.startswith(".") and nfc(f.name).lower() not in SKIP]


def run_fields(c):
    """이번 실행에서 AI가 고를 분야: Court에 적힌 분야, 없으면 이미지가 들어 있는 폴더들."""
    if c and c.get("fields"):
        return c["fields"]
    codes = []
    for i in images():
        if i["truth"] not in codes:
            codes.append(i["truth"])
    return {k: T.FIELD_DEFS.get(k, "") for k in codes}


def reviews():
    r = jload(REVIEWS, {})
    for k in ("tags", "field", "added", "notes"):
        r.setdefault(k, {})
    return r


def experiments():
    out = []
    for m in sorted(RUN_DIR.glob("*.meta.json")):
        meta = jload(m, None)
        if meta:
            out.append(meta)
    return sorted(out, key=lambda m: m["id"])


def records(exp_id):
    p = RUN_DIR / f"{exp_id}.jsonl"
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


# ---------- running ----------
def start_run(cfg):
    with LOCK:
        if JOB.get("running"):
            return {"error": "이미 실행 중이에요"}
        prov = cfg["provider"]
        key = KEYS.get(prov) or os.environ.get({"anthropic": "ANTHROPIC_API_KEY", "gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY"}.get(prov, ""), "")
        if prov != "mock" and not key:
            return {"error": "API 키를 먼저 입력해 주세요"}
        c = dict(court(cfg.get("court", courts()[-1]["version"])))
        c["fields"] = run_fields(c)
        imgs = images()
        if cfg.get("folders"):
            imgs = [i for i in imgs if i["folder"] in cfg["folders"]]
        if cfg.get("limit"):
            imgs = imgs[: int(cfg["limit"])]
        if not imgs:
            return {"error": "이미지가 없어요"}
        modes = ["list", "free"] if cfg.get("mode") == "both" else [cfg.get("mode", "list")]
        reps = max(1, min(5, int(cfg.get("reps", 3))))
        stamp = time.strftime("%Y%m%d-%H%M%S")
        exps = []
        for mode in modes:
            eid = f"{stamp}_{mode}"
            meta = {"id": eid, "provider": prov, "model": cfg.get("model", ""), "mode": mode, "reps": reps,
                    "court": c["version"], "size": int(cfg.get("size", 512)), "images": len(imgs),
                    "started": time.strftime("%Y-%m-%d %H:%M"), "label": cfg.get("label", ""), "done": False,
                    "fields": list(c["fields"])}
            jsave(RUN_DIR / f"{eid}.meta.json", meta)
            exps.append(meta)
        jobs = [(m, r, i) for m in exps for r in range(1, reps + 1) for i in imgs]
        JOB.clear()
        JOB.update(running=True, total=len(jobs), done=0, errors=0, last_error="", started=time.time(), exps=[e["id"] for e in exps], stop=False)
    threading.Thread(target=_worker, args=(jobs, c, key, int(cfg.get("workers", 4))), daemon=True).start()
    return {"ok": True, "jobs": len(jobs)}


def retry_failed(cfg):
    """가장 최근 실행에서 실패했거나 멈춰서 빠진 건만 다시 보내요. 성공한 건 그대로 둠요."""
    with LOCK:
        if JOB.get("running"):
            return {"error": "이미 실행 중이에요"}
        exps = experiments()
        if not exps:
            return {"error": "다시 돌릴 실행 기록이 없어요"}
        stamp = exps[-1]["id"].rsplit("_", 1)[0]
        last = [e for e in exps if e["id"].startswith(stamp + "_")]
        prov, model = last[0]["provider"], cfg.get("model") or last[0]["model"]
        key = KEYS.get(prov) or os.environ.get({"anthropic": "ANTHROPIC_API_KEY", "gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY"}.get(prov, ""), "")
        if prov != "mock" and not key:
            return {"error": "API 키를 먼저 입력해 주세요"}
        c = dict(court(last[0]["court"]))
        c["fields"] = {k: run_fields(court(last[0]["court"])).get(k, T.FIELD_DEFS.get(k, "")) for k in last[0].get("fields", [])} or run_fields(c)
        imgs = images()[: last[0]["images"]]
        jobs = []
        for meta in last:
            recs = records(meta["id"])
            good = [r for r in recs if not r.get("error")]
            ok = {(r["image"], r["rep"]) for r in good}
            with open(RUN_DIR / f"{meta['id']}.jsonl", "w", encoding="utf-8") as f:
                for r in good:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
            meta.update(model=model, done=False)
            jsave(RUN_DIR / f"{meta['id']}.meta.json", meta)
            jobs += [(meta, r, i) for r in range(1, meta["reps"] + 1) for i in imgs if (i["id"], r) not in ok]
        if not jobs:
            return {"error": "실패하거나 빠진 건이 없어요"}
        JOB.clear()
        JOB.update(running=True, total=len(jobs), done=0, errors=0, last_error="", started=time.time(), exps=[e["id"] for e in last], stop=False)
    threading.Thread(target=_worker, args=(jobs, c, key, int(cfg.get("workers", 1))), daemon=True).start()
    return {"ok": True, "jobs": len(jobs)}


def _worker(jobs, c, key, workers):
    cache, fh = {}, {}
    wlock = threading.Lock()
    for m in {j[0]["id"]: j[0] for j in jobs}.values():
        fh[m["id"]] = open(RUN_DIR / f"{m['id']}.jsonl", "a", encoding="utf-8")

    def one(job):
        meta, rep, img = job
        if JOB.get("stop"):
            return
        data = cache.get(img["id"]) or img["path"].read_bytes()
        cache[img["id"]] = data
        def note(msg):
            JOB["retry"] = msg
            print("  [재시도]", msg, flush=True)
        res = T.tag_image(data, c, meta["provider"], meta["model"], key, mode=meta["mode"], size=meta["size"], on_retry=note)
        JOB["retry"] = ""
        rec = {"image": img["id"], "truth": img["truth"], "rep": rep, **res}
        with wlock:
            fh[meta["id"]].write(json.dumps(rec, ensure_ascii=False) + "\n")
            fh[meta["id"]].flush()
            JOB["done"] += 1
            if res.get("error"):
                JOB["errors"] += 1
                JOB["last_error"] = res["error"]

    try:
        with cf.ThreadPoolExecutor(max(1, min(8, workers))) as ex:
            list(ex.map(one, jobs))
    finally:
        for f in fh.values():
            f.close()
        for eid in JOB.get("exps", []):
            p = RUN_DIR / f"{eid}.meta.json"
            meta = jload(p, {})
            meta.update(done=True, finished=time.strftime("%Y-%m-%d %H:%M"), seconds=round(time.time() - JOB["started"], 1),
                        stopped=bool(JOB.get("stop")))
            jsave(p, meta)
        JOB["running"] = False


# ---------- metrics ----------
def jaccard(a, b):
    a, b = set(a), set(b)
    return 1.0 if not a and not b else len(a & b) / len(a | b)


def truth_of(img_id, folder_truth, rv):
    return rv["field"].get(img_id) or folder_truth


def metrics(exp_id):
    meta = jload(RUN_DIR / f"{exp_id}.meta.json", {})
    recs = records(exp_id)
    rv = reviews()
    good = [r for r in recs if not r.get("error")]
    by = defaultdict(list)
    for r in good:
        by[r["image"]].append(r)
    out = {"id": exp_id, "meta": meta, "calls": len(recs), "errors": len(recs) - len(good), "images": len(by)}
    if not good:
        return out
    # 분야 정확도
    call_ok = [r["field"] == truth_of(r["image"], r["truth"], rv) for r in good if truth_of(r["image"], r["truth"], rv)]
    major_ok, field_agree, per_field, confusion = [], [], defaultdict(lambda: [0, 0]), Counter()
    tag_cons, grp_cons, flicker = [], [], Counter()
    full = Counter()
    for img, rs in by.items():
        tr = truth_of(img, rs[0]["truth"], rv)
        fc = Counter(r["field"] for r in rs)
        maj = fc.most_common(1)[0][0]
        field_agree.append(len(fc) == 1)
        if tr:
            major_ok.append(maj == tr)
            per_field[tr][1] += 1
            per_field[tr][0] += maj == tr
            if maj != tr:
                confusion[f"{tr} → {maj}"] += 1
        if len(rs) > 1:
            pairs = list(itertools.combinations(rs, 2))
            tag_cons.append(sum(jaccard(a["tags"], b["tags"]) for a, b in pairs) / len(pairs))
            grp_cons.append(sum(a["group_name"] == b["group_name"] for a, b in pairs) / len(pairs))
            tc = Counter(t for r in rs for t in set(r["tags"]))
            for t, n in tc.items():
                (full if n == len(rs) else flicker)[t] += 1
    # 사람 검토로 본 태그 정확도
    verdicts = Counter()
    reviewed_pairs = total_pairs = 0
    for img, rs in by.items():
        for t in {t for r in rs for t in r["tags"]}:
            total_pairs += 1
            v = rv["tags"].get(f"{img}|{t}")
            if v:
                reviewed_pairs += 1
                verdicts[v] += 1
    # 쏠림
    usage = Counter(t for rs in by.values() for t in {t for r in rs for t in r["tags"]})
    n_img = len(by)
    tot_use = sum(usage.values()) or 1
    top5 = usage.most_common(5)
    dropped = Counter(t for r in good for t in r.get("dropped", []))
    tin = [r["in_tokens"] for r in good if r.get("in_tokens")]
    tout = [r["out_tokens"] for r in good if r.get("out_tokens")]
    avg_in = sum(tin) / len(tin) if tin else 0
    avg_out = sum(tout) / len(tout) if tout else 0
    c1 = T.cost_usd(meta.get("model"), avg_in, avg_out)
    pct = lambda xs: round(100 * sum(xs) / len(xs), 1) if xs else None
    out.update({
        "field_acc_call": pct(call_ok), "field_acc": pct(major_ok), "field_agree": pct(field_agree),
        "tag_consistency": round(100 * sum(tag_cons) / len(tag_cons), 1) if tag_cons else None,
        "group_consistency": round(100 * sum(grp_cons) / len(grp_cons), 1) if grp_cons else None,
        "precision": round(100 * verdicts["ok"] / (verdicts["ok"] + verdicts["bad"]), 1) if (verdicts["ok"] + verdicts["bad"]) else None,
        "verdicts": dict(verdicts), "reviewed_share": round(100 * reviewed_pairs / total_pairs, 1) if total_pairs else 0,
        "distinct_tags": len(usage), "top5": [[t, round(100 * n / n_img)] for t, n in top5],
        "top5_share": round(100 * sum(n for _, n in top5) / tot_use, 1),
        "overused": [t for t, n in usage.items() if n / n_img > 0.3],
        "dropped": dropped.most_common(15), "dropped_rate": round(100 * sum(dropped.values()) / max(1, sum(len(r["tags"]) + len(r.get("dropped", [])) for r in good)), 1),
        "per_field": {k: [v[0], v[1]] for k, v in per_field.items()}, "confusion": confusion.most_common(8),
        "flicker": sorted([[t, flicker[t], full[t]] for t in flicker], key=lambda x: -x[1])[:15],
        "avg_latency_ms": int(sum(r["latency_ms"] for r in good) / len(good)),
        "avg_in_tokens": round(avg_in, 1), "avg_out_tokens": round(avg_out, 1),
        "usd_per_1000": round(c1 * 1000, 3) if c1 is not None else None,
    })
    fa, tc = out["field_acc"], out["tag_consistency"]
    out["pass_field"] = None if fa is None else fa >= 90
    out["pass_consistency"] = None if tc is None else tc >= 80
    return out


def suggestions(version):
    """Court를 어떻게 고칠지 데이터로 제안해요."""
    c = court(version)
    if not c:
        return {}
    allowed = {t["tag"] for t in c["tags"]}
    rv = reviews()
    bad, seen = Counter(), Counter()
    for k, v in rv["tags"].items():
        tag = k.split("|", 1)[1]
        seen[tag] += 1
        bad[tag] += v == "bad"
    used, flick, free_cand = Counter(), Counter(), Counter()
    list_exps = [e for e in experiments() if e.get("court") == version and e["mode"] == "list"]
    for e in list_exps:
        m = metrics(e["id"])
        for t, part, fullc in m.get("flicker", []):
            flick[t] += part
        for r in records(e["id"]):
            used.update(r.get("tags", []))
    for e in experiments():
        if e["mode"] == "free":
            for r in records(e["id"]):
                free_cand.update(t for t in r.get("tags", []) if t not in allowed)
    added = Counter(T.norm_tag(t) for ts in rv["added"].values() for t in ts if T.norm_tag(t) not in allowed)
    return {
        "often_wrong": [[t, bad[t], seen[t]] for t in seen if t in allowed and seen[t] >= 3 and bad[t] / seen[t] >= 0.4],
        "flickering": [[t, n] for t, n in flick.most_common(12) if n >= 2],
        "unused": sorted(allowed - set(used)) if list_exps else [],
        "add_from_free": [[t, n] for t, n in free_cand.most_common(15) if n >= 3],
        "add_from_review": added.most_common(15),
    }


# ---------- HTTP ----------
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, obj, code=200, ctype="application/json; charset=utf-8"):
        body = obj if isinstance(obj, (bytes, bytearray)) else json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        p = u.path
        if p in ("/", "/index.html"):
            return self.send((HERE / "ui" / "index.html").read_bytes(), ctype="text/html; charset=utf-8")
        if p.startswith("/ui/"):
            f = (HERE / p.lstrip("/")).resolve()
            if (HERE / "ui") in f.parents and f.exists():
                return self.send(f.read_bytes(), ctype=mimetypes.guess_type(str(f))[0] or "application/octet-stream")
        if p == "/img":
            rel = nfc(q.get("id", ""))
            for i in images():
                if i["id"] == rel:
                    return self.send(i["path"].read_bytes(), ctype=mimetypes.guess_type(str(i["path"]))[0] or "image/jpeg")
            return self.send({"error": "not found"}, 404)
        if p == "/api/state":
            imgs = images()
            return self.send({
                "images_dir": str(IMAGES), "fields": run_fields(courts()[-1] if courts() else None),
                "folders": [{"name": f, "code": T.field_code(f)} for f in folders()],
                "images": [{k: v for k, v in i.items() if k != "path"} for i in imgs],
                "courts": [{"version": c["version"], "note": c.get("note", ""), "created": c.get("created", ""), "n": len(c["tags"])} for c in courts()],
                "experiments": experiments(), "keys": {k: True for k in KEYS}, "prices": T.PRICES,
                "job": {k: v for k, v in JOB.items() if k != "stop"},
            })
        if p == "/api/court":
            return self.send(court(q.get("v", courts()[-1]["version"])) or {})
        if p == "/api/metrics":
            return self.send(metrics(q["id"]))
        if p == "/api/suggest":
            return self.send(suggestions(int(q.get("v", courts()[-1]["version"]))))
        if p == "/api/review_item":
            return self.send(review_item(nfc(q["id"])))
        if p == "/api/export.csv":
            return self.send(export_csv().encode("utf-8-sig"), ctype="text/csv; charset=utf-8")
        return self.send({"error": "not found"}, 404)

    def do_POST(self):
        global IMAGES
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        p = u.path
        if p == "/api/upload":
            folder = nfc(q.get("folder", ""))
            if folder not in folders():
                return self.send({"error": "없는 폴더예요"}, 400)
            name = Path(nfc(q.get("name", "image.jpg"))).name
            if Path(name).suffix.lower() not in EXTS:
                return self.send({"error": "jpg/png/webp만 돼요"}, 400)
            d = IMAGES / folder
            d.mkdir(parents=True, exist_ok=True)
            target = d / name
            n = 1
            while target.exists():
                target = d / f"{Path(name).stem}_{n}{Path(name).suffix}"
                n += 1
            target.write_bytes(self.body())
            return self.send({"ok": True, "id": f"{folder}/{target.name}"})
        data = json.loads(self.body() or b"{}")
        if p == "/api/images_dir":
            d = Path(data.get("path", "")).expanduser()
            if not d.is_dir():
                return self.send({"error": "폴더를 찾을 수 없어요: " + str(d)}, 400)
            IMAGES = d.resolve()
            return self.send({"ok": True})
        if p == "/api/folder":
            name = nfc(str(data.get("name", "")).strip()).replace("/", "").replace("\\", "")
            if not name:
                return self.send({"error": "이름이 비었어요"}, 400)
            (IMAGES / name).mkdir(parents=True, exist_ok=True)
            return self.send({"ok": True})
        if p == "/api/key":
            if data.get("key"):
                KEYS[data["provider"]] = data["key"].strip()
            else:
                KEYS.pop(data.get("provider"), None)
            return self.send({"ok": True})
        if p == "/api/run":
            return self.send(start_run(data))
        if p == "/api/retry":
            return self.send(retry_failed(data))
        if p == "/api/stop":
            JOB["stop"] = True
            return self.send({"ok": True})
        if p == "/api/review":
            with LOCK:
                rv = reviews()
                img = nfc(data["image"])
                if "tag" in data:
                    k = f"{img}|{data['tag']}"
                    if data.get("verdict"):
                        rv["tags"][k] = data["verdict"]
                    else:
                        rv["tags"].pop(k, None)
                if "field" in data:
                    if data["field"]:
                        rv["field"][img] = data["field"]
                    else:
                        rv["field"].pop(img, None)
                if "added" in data:
                    rv["added"][img] = [T.norm_tag(t) for t in data["added"] if T.norm_tag(t)]
                jsave(REVIEWS, rv)
            return self.send({"ok": True})
        if p == "/api/court":
            vs = [c["version"] for c in courts()]
            v = (max(vs) if vs else 0) + 1
            tags, seen = [], set()
            for t in data.get("tags", []):
                n = T.norm_tag(t.get("tag", ""))
                if n and n not in seen:
                    seen.add(n)
                    tags.append({"tag": n, "group": (t.get("group") or "기타").strip(), "def": (t.get("def") or "").strip()})
            c = {"version": v, "note": data.get("note", ""), "created": time.strftime("%Y-%m-%d %H:%M"),
                 "min_tags": int(data.get("min_tags", 5)), "max_tags": int(data.get("max_tags", 8)),
                 "rules": [r.strip() for r in data.get("rules", []) if r.strip()], "tags": tags}
            if data.get("fields"):
                c["fields"] = {T.field_code(k): (v or "").strip() for k, v in data["fields"].items() if k.strip()}
            jsave(COURT_DIR / f"court_v{v}.json", c)
            return self.send({"ok": True, "version": v})
        return self.send({"error": "not found"}, 404)


def review_item(img_id):
    """검토 화면용: 이 이미지에 AI가 붙인 태그 전부(어느 실험·방식인지는 숨김) + 미끼 태그 1개."""
    rv = reviews()
    proposed, fields, groups = Counter(), Counter(), Counter()
    for e in experiments():
        for r in records(e["id"]):
            if r["image"] == img_id and not r.get("error"):
                proposed.update(set(r["tags"]))
                fields[r["field"]] += 1
                groups[r["group_name"]] += 1
    all_court = [t["tag"] for c in courts()[-1:] for t in c["tags"]]
    rnd = random.Random(img_id)
    decoy_pool = [t for t in all_court if t not in proposed]
    decoy = rnd.choice(decoy_pool) if decoy_pool else None
    tags = list(proposed) + ([decoy] if decoy else [])
    rnd.shuffle(tags)
    folder = img_id.split("/", 1)[0]
    return {"id": img_id, "folder_truth": T.field_code(folder), "field_override": rv["field"].get(img_id),
            "ai_fields": fields.most_common(), "groups": groups.most_common(5), "tags": tags, "decoy": decoy,
            "verdicts": {t: rv["tags"].get(f"{img_id}|{t}") for t in tags}, "added": rv["added"].get(img_id, [])}


def export_csv():
    cols = ["id", "label", "provider", "model", "mode", "court", "reps", "images", "calls", "errors", "field_acc", "field_acc_call",
            "field_agree", "tag_consistency", "group_consistency", "precision", "reviewed_share", "distinct_tags", "top5_share",
            "dropped_rate", "avg_latency_ms", "avg_in_tokens", "avg_out_tokens", "usd_per_1000", "pass_field", "pass_consistency"]
    rows = [",".join(cols)]
    for e in experiments():
        m = metrics(e["id"])
        flat = {**e, **m}
        rows.append(",".join('"' + ("" if flat.get(c) is None else str(flat.get(c))).replace('"', "'") + '"' for c in cols))
    return "\n".join(rows)


def main():
    global IMAGES
    ap = argparse.ArgumentParser()
    cands = [HERE.parent / n for n in ("samples", "axia-test3")] + [Path.home() / d / n for d in ("Downloads", "Desktop") for n in ("samples", "axia-test3")]
    default = next((p for p in cands if p.is_dir()), DATA / "images")
    ap.add_argument("--images", default=str(default), help="분야별 하위 폴더가 든 이미지 폴더")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--skip", default="package", help="무시할 폴더 이름 (쉼표로 구분, 기본: package)")
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    IMAGES = Path(a.images).expanduser().resolve()
    SKIP.update(s.strip().lower() for s in a.skip.split(",") if s.strip())
    for d in (COURT_DIR, RUN_DIR):
        d.mkdir(parents=True, exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    ensure_court()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), H)
    url = f"http://localhost:{a.port}"
    print(f"Axia Tag Lab 실행 중 → {url}\n이미지 폴더: {IMAGES}\n끄려면 이 창에서 Ctrl+C")
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n종료했어요.")


if __name__ == "__main__":
    main()
