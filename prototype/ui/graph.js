// Axia 네트워크 그래프 보기
// - "이미지끼리": 태그가 많이 겹치는 이미지끼리 선으로 이어요(자카드 유사도). 각 이미지는 가장 비슷한 몇 장과만 이어서 실타래가 되지 않게 해요.
// - "태그 중심": 태그를 점으로 두고, 이미지를 그 태그에 이어요. 어떤 태그가 많은 레퍼런스를 묶는지 보여요.
// 위치는 힘 기반 배치(서로 밀어내고, 이어진 것끼리 당김)로 계산해요. 외부 라이브러리 없이 canvas로 그려요.
const Graph = (() => {
  const FIELD_COLOR = {"3d": "#2f4bff", graphic: "#e0533d", typography: "#111111", painting: "#b5771e", photo: "#1a8a6a", package: "#8a3fd1", video: "#d1347a", ui_ux: "#1a9bd1", spatial: "#6b7d1a", editorial: "#7a5a3a", ai_image: "#c4a000"};
  const color = f => FIELD_COLOR[f] || "#9a9a9a";
  const pos = new Map();           // id -> {x, y, vx, vy} (다시 그려도 위치 유지)
  const imgCache = new Map();
  let st = null;                   // 현재 그래프 상태
  let lastView = null;             // 다시 그려도 확대·위치 유지
  let opt = {mode: "image", threshold: 0.25, k: 4};
  try { Object.assign(opt, JSON.parse(localStorage.getItem("axia-graph") || "{}")); } catch (e) {}
  const saveOpt = () => { try { localStorage.setItem("axia-graph", JSON.stringify(opt)); } catch (e) {} };

  function jac(a, b) {
    if (!a.size || !b.size) return 0;
    let n = 0;
    for (const t of a) if (b.has(t)) n++;
    return n / (a.size + b.size - n);
  }
  function thumb(file) {
    if (!imgCache.has(file)) { const im = new Image(); im.src = "/img/" + file; im.onload = () => st && (st.dirty = true); imgCache.set(file, im); }
    return imgCache.get(file);
  }

  function build(items) {
    const MAX = 600;
    const list = items.slice(0, MAX);
    const nodes = [], edges = [];
    const sets = list.map(i => new Set(tagsOf(i)));
    list.forEach(i => nodes.push({id: i.id, kind: "img", item: i, r: 26}));
    if (opt.mode === "image") {
      const best = list.map(() => []);
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        let s = jac(sets[a], sets[b]);
        if (list[a].field && list[a].field === list[b].field) s += 0.05;
        if (s >= opt.threshold) { best[a].push([s, b]); best[b].push([s, a]); }
      }
      const seen = new Set();
      best.forEach((arr, a) => arr.sort((x, y) => y[0] - x[0]).slice(0, opt.k).forEach(([s, b]) => {
        const key = a < b ? a + "-" + b : b + "-" + a;
        if (!seen.has(key)) { seen.add(key); edges.push({a, b, w: s}); }
      }));
    } else {
      const count = {};
      sets.forEach(s => s.forEach(t => count[t] = (count[t] || 0) + 1));
      const tags = Object.entries(count).filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).slice(0, 60);
      const idx = {};
      tags.forEach(([t, n]) => { idx[t] = nodes.length; nodes.push({id: "tag:" + t, kind: "tag", label: t, n, r: 8 + Math.sqrt(n) * 3}); });
      sets.forEach((s, a) => s.forEach(t => { if (idx[t] != null) edges.push({a, b: idx[t], w: 0.5}); }));
    }
    // 위치: 예전 위치가 있으면 그대로, 없으면 분야별로 원 위에 흩어 시작
    const fields = [...new Set(list.map(i => i.field || "?"))];
    nodes.forEach((n, i) => {
      let p = pos.get(n.id);
      if (!p) {
        const f = n.item ? fields.indexOf(n.item.field || "?") : i;
        const ang = (f / Math.max(1, fields.length)) * Math.PI * 2 + Math.random() * 0.6;
        const rad = 200 + Math.random() * 160;
        p = {x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, vx: 0, vy: 0};
        pos.set(n.id, p);
        n.fresh = true;
      }
      n.p = p;
    });
    const deg = new Array(nodes.length).fill(0);
    edges.forEach(e => { deg[e.a]++; deg[e.b]++; });
    const fresh = nodes.filter(n => n.fresh).length;
    return {nodes, edges, deg, truncated: items.length > MAX, total: items.length, fresh};
  }

  function tick(g, alpha) {
    const N = g.nodes.length;
    for (let i = 0; i < N; i++) {
      const a = g.nodes[i].p;
      for (let j = i + 1; j < N; j++) {
        const b = g.nodes[j].p;
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 250000) continue;
        const min = g.nodes[i].r + g.nodes[j].r + 6;
        let f = 900 / d2;
        if (d2 < min * min) f += 0.6 * (min - Math.sqrt(d2)) / Math.sqrt(d2);
        dx *= f * alpha; dy *= f * alpha;
        a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
    }
    for (const e of g.edges) {
      const a = g.nodes[e.a].p, b = g.nodes[e.b].p;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const len = opt.mode === "image" ? 70 : 90;
      const f = (d - len) / d * 0.04 * (0.5 + e.w) * alpha;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const n of g.nodes) {
      const p = n.p;
      if (n === g.dragging) { p.vx = p.vy = 0; continue; }
      p.vx -= p.x * 0.012 * alpha; p.vy -= p.y * 0.012 * alpha;  // 가운데로 살짝
      p.vx *= 0.6; p.vy *= 0.6;
      p.x += p.vx; p.y += p.vy;
    }
  }

  function paint(g) {
    const {ctx, cv, view} = st;
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.translate(view.x, view.y);
    ctx.scale(view.s, view.s);
    const hov = st.hover;
    const near = new Set();
    if (hov != null) g.edges.forEach(e => { if (e.a === hov) near.add(e.b); if (e.b === hov) near.add(e.a); });
    for (const e of g.edges) {
      const a = g.nodes[e.a].p, b = g.nodes[e.b].p;
      const on = hov != null && (e.a === hov || e.b === hov);
      ctx.strokeStyle = on ? "rgba(47,75,255,.8)" : `rgba(0,0,0,${hov != null ? 0.04 : 0.08 + e.w * 0.25})`;
      ctx.lineWidth = (on ? 2 : 1) / view.s;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    g.nodes.forEach((n, i) => {
      const {x, y} = n.p;
      const dim = hov != null && i !== hov && !near.has(i);
      ctx.globalAlpha = dim ? 0.25 : 1;
      if (n.kind === "img") {
        const im = thumb(n.item.file);
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, n.r, 0, Math.PI * 2); ctx.closePath();
        ctx.fillStyle = "#ddd"; ctx.fill();
        if (im.complete && im.naturalWidth) {
          ctx.clip();
          const s = Math.max(2 * n.r / im.naturalWidth, 2 * n.r / im.naturalHeight);
          ctx.drawImage(im, x - im.naturalWidth * s / 2, y - im.naturalHeight * s / 2, im.naturalWidth * s, im.naturalHeight * s);
        }
        ctx.restore();
        ctx.beginPath(); ctx.arc(x, y, n.r, 0, Math.PI * 2);
        ctx.strokeStyle = color(n.item.field); ctx.lineWidth = (i === hov ? 4 : 2.5) / Math.sqrt(view.s); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(x, y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = "#151515"; ctx.fill();
        ctx.fillStyle = "#151515"; ctx.font = `600 ${11.5 / view.s}px -apple-system, sans-serif`; ctx.textAlign = "center";
        ctx.fillText(n.label, x, y - n.r - 4);
      }
    });
    ctx.globalAlpha = 1;
    // 툴팁
    if (hov != null) {
      const n = g.nodes[hov];
      const text = n.kind === "img" ? `${fk(n.item.field)} · ${tagsOf(n.item).slice(0, 6).join(", ")}` : `${n.label} · ${n.n}장`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sx = n.p.x * view.s + view.x, sy = n.p.y * view.s + view.y;
      ctx.font = "12px -apple-system, sans-serif";
      const w = ctx.measureText(text).width + 16;
      const tx = Math.min(sx + 14, cv.width / dpr - w - 6), ty = Math.max(sy - 34, 6);
      ctx.fillStyle = "rgba(20,20,20,.92)"; ctx.beginPath(); ctx.roundRect(tx, ty, w, 24, 6); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.fillText(text, tx + 8, ty + 16);
    }
  }

  function toWorld(ev) {
    const r = st.cv.getBoundingClientRect();
    return {x: (ev.clientX - r.left - st.view.x) / st.view.s, y: (ev.clientY - r.top - st.view.y) / st.view.s};
  }
  function hit(g, w) {
    for (let i = g.nodes.length - 1; i >= 0; i--) {
      const n = g.nodes[i], dx = n.p.x - w.x, dy = n.p.y - w.y;
      if (dx * dx + dy * dy <= (n.r + 3) * (n.r + 3)) return i;
    }
    return null;
  }

  function render(container, items) {
    if (st) cancelAnimationFrame(st.raf);
    const legendFields = [...new Set(items.map(i => i.field).filter(Boolean))];
    container.innerHTML = `
      <div class="row" style="margin-bottom:10px">
        <div class="seg" id="gmode"><button data-m="image" class="${opt.mode === "image" ? "on" : ""}">이미지끼리</button><button data-m="tag" class="${opt.mode === "tag" ? "on" : ""}">태그 중심</button></div>
        <label class="tags" style="display:${opt.mode === "image" ? "flex" : "none"};gap:6px;align-items:center">연결 기준 <input id="gth" type="range" min="0.1" max="0.6" step="0.05" value="${opt.threshold}" style="width:120px"> <span id="gthv">${Math.round(opt.threshold * 100)}%</span></label>
        <button class="ghost" id="gfit">화면 맞추기</button>
        <span class="tags" id="ginfo"></span>
      </div>
      <div class="tags" style="margin-bottom:6px">${legendFields.map(f => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px"><i style="width:10px;height:10px;border-radius:50%;border:2.5px solid ${color(f)};display:inline-block"></i>${esc(fk(f))}</span>`).join("")}</div>
      <div style="position:relative;height:calc(100vh - 230px);min-height:420px;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden"><canvas id="gcv" style="width:100%;height:100%;display:block;cursor:grab"></canvas></div>
      <p class="tags" style="margin-top:6px">드래그로 이동 · 휠로 확대 · 점을 끌어 옮기기 · 클릭하면 상세 · 마우스를 올리면 연결된 것만 보여요</p>`;
    const cv = container.querySelector("#gcv");
    const g = build(items);
    const calm = lastView && g.fresh < g.nodes.length * 0.2;
    st = {cv, ctx: cv.getContext("2d"), g, view: calm ? lastView : {x: 0, y: 0, s: 1}, fitted: !!calm, hover: null, alpha: calm ? 0.15 : 1, dirty: true, raf: 0};
    lastView = st.view;
    const resize = () => {
      const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      if (!st.fitted) { st.view.x = r.width / 2; st.view.y = r.height / 2; }
      st.dirty = true;
    };
    resize();
    new ResizeObserver(resize).observe(cv);
    container.querySelector("#ginfo").textContent = `점 ${g.nodes.length}개 · 선 ${g.edges.length}개${g.truncated ? ` (최근 600장만 표시, 전체 ${g.total}장 — 필터로 좁혀 보세요)` : ""}`;
    container.querySelectorAll("#gmode button").forEach(b => b.onclick = () => { opt.mode = b.dataset.m; saveOpt(); render(container, items); });
    const th = container.querySelector("#gth");
    th.oninput = () => { container.querySelector("#gthv").textContent = Math.round(th.value * 100) + "%"; };
    th.onchange = () => { opt.threshold = +th.value; saveOpt(); render(container, items); };
    container.querySelector("#gfit").onclick = () => fit();

    function fit() {
      const r = cv.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      g.nodes.forEach(n => { x0 = Math.min(x0, n.p.x); y0 = Math.min(y0, n.p.y); x1 = Math.max(x1, n.p.x); y1 = Math.max(y1, n.p.y); });
      if (!isFinite(x0)) return;
      const s = Math.min(2, 0.9 * Math.min(r.width / (x1 - x0 + 80), r.height / (y1 - y0 + 80)));
      st.view = lastView = {s, x: r.width / 2 - (x0 + x1) / 2 * s, y: r.height / 2 - (y0 + y1) / 2 * s};
      st.fitted = true; st.dirty = true;
    }

    let drag = null, moved = false;
    cv.onmousedown = ev => {
      const w = toWorld(ev), i = hit(g, w);
      moved = false;
      drag = i != null ? {node: i} : {pan: true, x: ev.clientX - st.view.x, y: ev.clientY - st.view.y};
      if (i != null) { g.dragging = g.nodes[i]; st.alpha = Math.max(st.alpha, 0.3); }
      cv.style.cursor = "grabbing";
    };
    window.addEventListener("mouseup", () => {
      if (drag && drag.node != null && !moved) { const n = g.nodes[drag.node]; if (n.kind === "img") openDetail(n.item.id); else { filt.tag = n.label; view = "grid"; document.querySelectorAll(".seg button[data-v]").forEach(x => x.classList.toggle("on", x.dataset.v === "grid")); draw(); } }
      drag = null; g.dragging = null; cv.style.cursor = "grab";
    });
    cv.onmousemove = ev => {
      if (drag) {
        moved = true;
        if (drag.pan) { st.view.x = ev.clientX - drag.x; st.view.y = ev.clientY - drag.y; st.fitted = true; }
        else { const w = toWorld(ev); const p = g.nodes[drag.node].p; p.x = w.x; p.y = w.y; st.alpha = Math.max(st.alpha, 0.2); }
        st.dirty = true;
        return;
      }
      const i = hit(g, toWorld(ev));
      if (i !== st.hover) { st.hover = i; st.dirty = true; cv.style.cursor = i != null ? "pointer" : "grab"; }
    };
    cv.onmouseleave = () => { st.hover = null; st.dirty = true; };
    cv.onwheel = ev => {
      ev.preventDefault();
      const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const k = Math.exp(-ev.deltaY * 0.0015), s = Math.min(6, Math.max(0.1, st.view.s * k));
      st.view.x = mx - (mx - st.view.x) * (s / st.view.s); st.view.y = my - (my - st.view.y) * (s / st.view.s); st.view.s = s;
      st.fitted = true; st.dirty = true;
    };

    let frames = 0;
    const loop = () => {
      if (!document.body.contains(cv)) return;
      if (st.alpha > 0.02) { tick(g, st.alpha); st.alpha *= 0.985; st.dirty = true; if (++frames === 60 && !st.fitted) fit(); }
      if (st.dirty) { paint(g); st.dirty = false; }
      st.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  return {render};
})();
