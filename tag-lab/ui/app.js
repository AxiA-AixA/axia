const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const api = (p, body) => fetch(p, body === undefined ? {} : {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}).then(r => r.json());
const imgUrl = id => "/img?id=" + encodeURIComponent(id);
const FIELD_KO = {video: "영상", ai_image: "AI이미지", "3d": "3D", graphic: "그래픽", editorial: "편집디자인", photo: "사진", ui_ux: "UIUX", spatial: "공간전시", typography: "타이포그래피", painting: "회화", package: "패키지"};
const lbl = f => FIELD_KO[f] ? `${FIELD_KO[f]} (${f})` : f;
let S = null, cur = null, selExp = null, courtData = null;

// ---------- tabs ----------
document.querySelectorAll("#nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#nav button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll("main section").forEach(s => s.classList.toggle("on", s.id === b.dataset.t));
  ({imgs: drawImgs, run: drawRun, review: drawReviewList, results: drawResults, court: loadCourt})[b.dataset.t]();
});

async function refresh() { S = await api("/api/state"); }

// ---------- 1 images ----------
function drawImgs() {
  $("#imgdir").value = S.images_dir;
  if (!S.folders.length) { $("#cats").innerHTML = '<p class="muted">이 폴더 안에 분야별 하위 폴더가 없어요. 위에서 폴더 경로를 바꾸거나 새 분야 폴더를 만드세요.</p>'; return; }
  $("#cats").innerHTML = S.folders.map(({name: f, code}) => {
    const list = S.images.filter(i => i.folder === f);
    return `<div class="card cat" data-f="${esc(f)}"><h3>${esc(f)} <small class="muted">→ 분야 코드 ${esc(code)}</small> <small class="${list.length >= 10 ? "full" : "lack"}">${list.length} / 10장</small></h3>
      <div class="thumbs">${list.slice(0, 15).map(i => `<img loading="lazy" src="${imgUrl(i.id)}" title="${esc(i.id)}">`).join("")}</div>
      <div class="drop">여기에 끌어다 놓기 또는 <label>파일 선택<input type="file" multiple accept="image/jpeg,image/png,image/webp" hidden></label></div></div>`;
  }).join("");
  document.querySelectorAll(".cat").forEach(el => {
    const f = el.dataset.f;
    el.ondragover = e => { e.preventDefault(); el.classList.add("drag"); };
    el.ondragleave = () => el.classList.remove("drag");
    el.ondrop = e => { e.preventDefault(); el.classList.remove("drag"); upload(f, e.dataTransfer.files); };
    el.querySelector("input").onchange = e => upload(f, e.target.files);
  });
}
$("#setdir").onclick = async () => { const r = await api("/api/images_dir", {path: $("#imgdir").value}); if (r.error) return alert(r.error); await refresh(); drawImgs(); };
$("#mkdir").onclick = async () => { const r = await api("/api/folder", {name: $("#newfolder").value}); if (r.error) return alert(r.error); $("#newfolder").value = ""; await refresh(); drawImgs(); };
async function upload(folder, files) {
  for (const file of files) {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) { alert(file.name + ": jpg/png/webp만 돼요"); continue; }
    await fetch(`/api/upload?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}`, {method: "POST", body: file});
  }
  await refresh(); drawImgs();
}

// ---------- 2 run ----------
function drawRun() {
  $("#models").innerHTML = Object.keys(S.prices).map(m => `<option value="${m}">`).join("");
  $("#runcourt").innerHTML = S.courts.map(c => `<option value="${c.version}">v${c.version} · 태그 ${c.n}개${c.note ? " · " + esc(c.note) : ""}</option>`).reverse().join("");
  keyStatus(); estimate(); drawProgress();
}
function keyStatus() {
  const p = $("#prov").value;
  $("#keyst").innerHTML = p === "mock" ? "(필요 없음)" : S.keys[p] ? '<span class="pass">입력됨</span>' : '<span class="fail">없음</span>';
}
function estimate() {
  const n = $("#limit").value ? Math.min(+$("#limit").value, S.images.length) : S.images.length;
  const modes = $("#mode").value === "both" ? 2 : 1, reps = +$("#reps").value || 3;
  const calls = n * modes * reps;
  const pr = S.prices[$("#model").value];
  const cost = pr ? calls * ((1300 * pr[0]) + (70 * pr[1])) / 1e6 : null;
  $("#est").textContent = `${n}장 × ${reps}회 × ${modes}방식 = ${calls}건 요청` + (cost != null ? ` · 예상 비용 약 $${cost.toFixed(2)}` : " · 이 모델 가격은 몰라서 비용은 계산 안 해요") + (calls ? ` · 약 ${Math.ceil(calls * 2.5 / 4 / 60)}분` : "");
}
["#prov", "#model", "#mode", "#reps", "#limit"].forEach(s => $(s).addEventListener("input", () => { keyStatus(); estimate(); }));
$("#prov").addEventListener("change", () => {
  const def = {anthropic: "claude-haiku-5-5", gemini: "gemini-3.1-flash-lite", openai: "gpt-5.4-nano", mock: "mock"};
  $("#model").value = def[$("#prov").value]; $("#workers").value = $("#prov").value === "gemini" ? 1 : 4; keyStatus(); estimate();
});
$("#savekey").onclick = async () => {
  await api("/api/key", {provider: $("#prov").value, key: $("#key").value});
  $("#key").value = ""; await refresh(); keyStatus();
};
$("#go").onclick = async () => {
  const r = await api("/api/run", {provider: $("#prov").value, model: $("#model").value, mode: $("#mode").value, reps: +$("#reps").value,
    court: +$("#runcourt").value, size: +$("#size").value, limit: $("#limit").value ? +$("#limit").value : 0, label: $("#label").value, workers: +$("#workers").value || 1});
  if (r.error) return alert(r.error);
  await refresh(); drawProgress(); poll();
};
$("#stop").onclick = () => api("/api/stop", {});
$("#retry").onclick = async () => {
  const r = await api("/api/retry", {workers: +$("#workers").value || 1, model: $("#model").value});
  if (r.error) return alert(r.error);
  await refresh(); drawProgress(); poll();
};
function drawProgress() {
  const j = S.job || {};
  $("#go").disabled = !!j.running; $("#stop").disabled = !j.running; $("#retry").disabled = !!j.running;
  if (!j.total) { $("#prog").innerHTML = ""; return; }
  const pct = Math.round(100 * j.done / j.total);
  $("#prog").innerHTML = `<div class="bar"><i style="width:${pct}%"></i></div>
    <p class="small">${j.running ? "실행 중" : "끝"} · ${j.done} / ${j.total}건 · 실패 ${j.errors}${j.last_error ? ` <span class="fail">마지막 오류: ${esc(j.last_error.slice(0, 160))}</span>` : ""}</p>
    ${j.running && j.retry ? `<p class="small" style="color:var(--meh)">기다리는 중: ${esc(j.retry)}</p>` : ""}
    ${!j.running ? '<p class="small">다음: <b>3 사람 검토</b>에서 태그를 확인하고, <b>4 결과</b>에서 숫자를 보세요.</p>' : ""}`;
}
async function poll() { await refresh(); drawProgress(); if (S.job.running) setTimeout(poll, 1500); }

// ---------- 3 review ----------
let rvCache = {};
async function drawReviewList() {
  const tagged = new Set();
  // images that have at least one record → ask server via review_item lazily; approximate using experiments existence
  const list = S.images;
  $("#rvlist").innerHTML = list.map(i => `<div data-id="${esc(i.id)}" class="${cur === i.id ? "on" : ""}"><img loading="lazy" src="${imgUrl(i.id)}"><span>${esc(i.id)}<br><span class="muted" data-st="${esc(i.id)}"></span></span></div>`).join("");
  document.querySelectorAll("#rvlist > div").forEach(d => d.onclick = () => openReview(d.dataset.id));
  $("#rvcount").textContent = S.experiments.length ? "" : "아직 AI를 돌린 기록이 없어요.";
  for (const i of list) { rvCache[i.id] = await api("/api/review_item?id=" + encodeURIComponent(i.id)); markStatus(i.id); }
  applyFilter();
}
function done(it) { return it.tags.length && it.tags.every(t => it.verdicts[t]); }
function markStatus(id) {
  const it = rvCache[id]; const el = document.querySelector(`[data-st="${CSS.escape(id)}"]`);
  if (!it || !el) return;
  const n = it.tags.filter(t => it.verdicts[t]).length;
  el.textContent = it.tags.length ? (done(it) ? "검토 완료" : `${n} / ${it.tags.length}`) : "AI 기록 없음";
  el.className = done(it) ? "pass" : "muted";
}
function applyFilter() {
  const only = $("#onlyopen").checked;
  let left = 0;
  document.querySelectorAll("#rvlist > div").forEach(d => { const it = rvCache[d.dataset.id]; const open = it && it.tags.length && !done(it); left += open ? 1 : 0; d.style.display = only && !open ? "none" : ""; });
  $("#rvcount").textContent = S.experiments.length ? `검토 남은 이미지 ${left}장` : "아직 AI를 돌린 기록이 없어요.";
}
$("#onlyopen").onchange = applyFilter;
async function openReview(id) {
  cur = id;
  document.querySelectorAll("#rvlist > div").forEach(d => d.classList.toggle("on", d.dataset.id === id));
  const it = rvCache[id] = await api("/api/review_item?id=" + encodeURIComponent(id));
  const truth = it.field_override || it.folder_truth || "";
  $("#rvmain").innerHTML = `<div class="rvmain"><div class="pic"><img src="${imgUrl(id)}"><p class="small muted">${esc(id)}</p></div><div>
    <label class="f">정답 분야 (폴더 기준, 잘못 넣은 이미지면 고치세요)</label>
    <select id="rvfield">${[...new Set([...Object.keys(S.fields), truth])].filter(Boolean).map(k => `<option value="${esc(k)}" ${k === truth ? "selected" : ""}>${esc(lbl(k))}</option>`).join("")}</select>
    <p class="small muted" style="margin:6px 0 14px">AI가 말한 분야: ${it.ai_fields.map(([f, n]) => `${esc(lbl(f))} ${n}번`).join(", ") || "없음"}</p>
    <label class="f">태그 검토 (${it.tags.length}개)</label>
    <div id="tagrows">${it.tags.map(t => `<div class="tagrow"><b>${esc(t)}</b><div class="vb" data-t="${esc(t)}">${["ok:맞음", "meh:애매", "bad:틀림"].map(x => { const [v, l] = x.split(":"); return `<button class="${v} ${it.verdicts[t] === v ? "on" : ""}" data-v="${v}">${l}</button>`; }).join("")}</div></div>`).join("") || '<p class="muted">이 이미지는 아직 AI 기록이 없어요.</p>'}</div>
    <label class="f" style="margin-top:14px">AI가 놓친 태그 (쉼표로 구분)</label><input id="rvadd" value="${esc(it.added.join(", "))}">
    <p class="small muted" style="margin-top:12px">AI가 붙인 그룹 이름: ${it.groups.map(([g, n]) => `${esc(g)} (${n})`).join(" · ") || "-"}</p>
    <div class="row" style="margin-top:14px"><button class="b" id="rvall" title="아직 안 누른 태그를 모두 맞음으로. 틀린 것만 골라 누르면 빨라요">남은 태그 모두 맞음</button><button class="b primary" id="rvnext">다음 이미지 →</button></div></div></div>`;
  $("#rvfield").onchange = e => api("/api/review", {image: id, field: e.target.value === it.folder_truth ? "" : e.target.value});
  $("#rvadd").onchange = e => api("/api/review", {image: id, added: e.target.value.split(",")});
  document.querySelectorAll(".vb").forEach(g => g.querySelectorAll("button").forEach(b => b.onclick = async () => {
    const t = g.dataset.t, v = it.verdicts[t] === b.dataset.v ? "" : b.dataset.v;
    it.verdicts[t] = v || null;
    g.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.v === v));
    await api("/api/review", {image: id, tag: t, verdict: v}); markStatus(id);
  }));
  $("#rvall").onclick = async () => {
    for (const t of it.tags) if (!it.verdicts[t]) { it.verdicts[t] = "ok"; await api("/api/review", {image: id, tag: t, verdict: "ok"}); }
    document.querySelectorAll(".vb").forEach(g => g.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.v === it.verdicts[g.dataset.t])));
    markStatus(id);
  };
  $("#rvnext").onclick = () => {
    const ids = S.images.map(i => i.id); const start = ids.indexOf(id);
    const nxt = ids.slice(start + 1).concat(ids.slice(0, start)).find(x => rvCache[x] && rvCache[x].tags.length && !done(rvCache[x])) || ids[(start + 1) % ids.length];
    openReview(nxt); applyFilter();
  };
}
document.addEventListener("keydown", e => {
  if (!$("#review").classList.contains("on") || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "ArrowRight" && $("#rvnext")) $("#rvnext").click();
});

// ---------- 4 results ----------
const cell = (v, pass) => v == null ? '<td class="muted">-</td>' : `<td class="${pass === true ? "pass" : pass === false ? "fail" : ""}">${v}%</td>`;
async function drawResults() {
  if (!S.experiments.length) { $("#exptable").innerHTML = '<tr><td class="muted">아직 실행 기록이 없어요.</td></tr>'; return; }
  const ms = [];
  for (const e of S.experiments.slice().reverse()) ms.push(await api("/api/metrics?id=" + e.id));
  $("#exptable").innerHTML = `<tr><th>실행</th><th>방식</th><th>규칙</th><th>모델</th><th>분야 정확도</th><th>분야 흔들림 없음</th><th>태그 일관성</th><th>그룹 이름 일치</th><th>태그 정확도<br>(검토 비율)</th><th>상위5 쏠림</th><th>목록 밖</th><th>1,000장 비용</th></tr>` +
    ms.map(m => `<tr class="click ${selExp === m.id ? "sel" : ""}" data-id="${m.id}"><td>${esc(m.meta.started)}${m.meta.label ? "<br><span class='small muted'>" + esc(m.meta.label) + "</span>" : ""}${m.meta.done ? "" : " <span class='small'>(진행 중)</span>"}</td>
      <td>${m.meta.mode === "list" ? "목록" : "자유"} ×${m.meta.reps}</td><td>v${m.meta.court}</td><td class="small">${esc(m.meta.model)}</td>
      ${cell(m.field_acc, m.pass_field)}${cell(m.field_agree)}${cell(m.tag_consistency, m.pass_consistency)}${cell(m.group_consistency)}
      <td>${m.precision == null ? "-" : m.precision + "%"}<br><span class="small muted">${m.reviewed_share ?? 0}% 검토</span></td>
      ${cell(m.top5_share)}<td>${m.meta.mode === "list" ? (m.dropped_rate ?? "-") + "%" : "-"}</td><td>${m.usd_per_1000 == null ? "-" : "$" + m.usd_per_1000}</td></tr>`).join("");
  document.querySelectorAll("#exptable tr.click").forEach(r => r.onclick = () => { selExp = r.dataset.id; drawResults(); });
  const m = ms.find(x => x.id === selExp) || ms[0]; selExp = m.id;
  document.querySelector(`#exptable tr[data-id="${m.id}"]`)?.classList.add("sel");
  drawDetail(m);
}
function drawDetail(m) {
  if (!m.calls) { $("#expdetail").innerHTML = ""; return; }
  const pf = Object.entries(m.per_field || {}).map(([f, [ok, n]]) => `<tr><td>${esc(lbl(f))}</td><td style="width:60%"><div class="bar"><i style="width:${100 * ok / n}%;background:${ok / n >= .9 ? "var(--ok)" : "var(--meh)"}"></i></div></td><td>${ok} / ${n}</td></tr>`).join("");
  $("#expdetail").innerHTML = `<div class="card"><h2>${esc(m.meta.started)} · ${m.meta.mode === "list" ? "태그 목록" : "자유 태그"} · 규칙 v${m.meta.court} · ${esc(m.meta.model)}</h2>
    <div class="kpi"><div><b>${m.images}</b><span>이미지</span></div><div><b>${m.calls}</b><span>요청 (실패 ${m.errors})</span></div><div><b>${(m.avg_latency_ms / 1000).toFixed(1)}초</b><span>장당 응답 시간</span></div><div><b>${m.avg_in_tokens} / ${m.avg_out_tokens}</b><span>평균 입력 / 출력 토큰</span></div><div><b>${m.distinct_tags}</b><span>쓰인 태그 종류</span></div></div>
    <div class="two"><div><h2>분야별 정확도</h2><table>${pf}</table>
      <h2 style="margin-top:16px">자주 헷갈린 분야 (정답 → AI 답)</h2><p class="chips">${(m.confusion || []).map(([k, n]) => `<span>${esc(k.replace(/\w+/g, w => FIELD_KO[w] || w))} ${n}</span>`).join("") || '<span class="muted">없음</span>'}</p></div>
    <div><h2>흔들리는 태그</h2><p class="small muted">3번 중 일부에서만 나온 이미지 수. 뜻을 적어 주면 줄어요.</p><p class="chips">${(m.flicker || []).map(([t, p]) => `<span>${esc(t)} ${p}</span>`).join("") || '<span class="muted">없음</span>'}</p>
      <h2>많이 쓰인 태그 (이미지 비율)</h2><p class="chips">${(m.top5 || []).map(([t, p]) => `<span>${esc(t)} ${p}%</span>`).join("")}</p>
      ${m.meta.mode === "list" ? `<h2>목록 밖이라 버려진 태그</h2><p class="chips">${(m.dropped || []).map(([t, n]) => `<span>${esc(t)} ${n}</span>`).join("") || '<span class="muted">없음</span>'}</p>` : ""}
      <h2>검토 결과</h2><p class="small">맞음 ${m.verdicts?.ok || 0} · 애매 ${m.verdicts?.meh || 0} · 틀림 ${m.verdicts?.bad || 0}</p></div></div></div>`;
}

// ---------- 5 court ----------
async function loadCourt(v) {
  $("#cver").innerHTML = S.courts.map(c => `<option value="${c.version}">v${c.version}</option>`).reverse().join("");
  if (v) $("#cver").value = v;
  courtData = await api("/api/court?v=" + $("#cver").value);
  $("#cmeta").textContent = `${courtData.created || ""} ${courtData.note ? "· " + courtData.note : ""}`;
  $("#rules").value = (courtData.rules || []).join("\n");
  $("#mint").value = courtData.min_tags || 5; $("#maxt").value = courtData.max_tags || 8; $("#cnote").value = "";
  courtData.fields = courtData.fields || {...S.fields};
  drawFieldRows(); drawCourtRows(); drawSugg();
}
function drawFieldRows() {
  $("#ftable").innerHTML = Object.entries(courtData.fields).map(([k, v]) => `<tr data-k="${esc(k)}"><td><b>${esc(k)}</b></td><td><input value="${esc(v)}" placeholder="뜻 없음"></td><td><button class="b" data-fdel style="padding:3px 8px">×</button></td></tr>`).join("");
  document.querySelectorAll("#ftable input").forEach(inp => inp.oninput = () => { courtData.fields[inp.closest("tr").dataset.k] = inp.value; });
  document.querySelectorAll("#ftable [data-fdel]").forEach(b => b.onclick = () => { delete courtData.fields[b.closest("tr").dataset.k]; drawFieldRows(); });
}
$("#addfield").onclick = () => { const k = prompt("분야 코드 (영어 소문자, 폴더 이름과 같게)"); if (k) { courtData.fields[k.trim().toLowerCase()] = ""; drawFieldRows(); } };
$("#cver").onchange = () => loadCourt($("#cver").value);
function drawCourtRows() {
  $("#ctable").innerHTML = courtData.tags.map((t, i) => `<tr data-i="${i}"><td><input data-k="tag" value="${esc(t.tag)}"></td><td><input data-k="group" value="${esc(t.group)}"></td><td><input data-k="def" value="${esc(t.def)}" placeholder="뜻 없음"></td><td><button class="b" data-del style="padding:3px 8px">×</button></td></tr>`).join("");
  $("#ccount").textContent = `태그 ${courtData.tags.length}개 · 뜻 적힌 태그 ${courtData.tags.filter(t => t.def).length}개`;
  document.querySelectorAll("#ctable input").forEach(inp => inp.oninput = () => { courtData.tags[+inp.closest("tr").dataset.i][inp.dataset.k] = inp.value; });
  document.querySelectorAll("#ctable [data-del]").forEach(b => b.onclick = () => { courtData.tags.splice(+b.closest("tr").dataset.i, 1); drawCourtRows(); });
}
function addTag(tag, group) {
  if (courtData.tags.some(t => t.tag === tag)) return;
  courtData.tags.push({tag: tag || "", group: group || "추가", def: ""}); drawCourtRows();
  const box = document.querySelector("#ctable").closest("div"); box.scrollTop = box.scrollHeight;
}
$("#addrow").onclick = () => addTag("", "추가");
$("#savecourt").onclick = async () => {
  const r = await api("/api/court", {tags: courtData.tags, fields: courtData.fields, rules: $("#rules").value.split("\n"), min_tags: +$("#mint").value, max_tags: +$("#maxt").value, note: $("#cnote").value});
  await refresh(); $("#csaved").innerHTML = `<span class="pass">v${r.version}로 저장했어요.</span> "2 AI 돌리기"에서 이 버전을 골라 다시 실행하세요.`;
  loadCourt(r.version);
};
async function drawSugg() {
  const s = await api("/api/suggest?v=" + $("#cver").value);
  const block = (title, help, arr, fmt, add) => `<h2 style="margin-top:14px">${title}</h2><p class="small muted">${help}</p><p class="chips">${arr && arr.length ? arr.map(x => `<span class="${add ? "add" : ""}" data-add="${add ? esc(Array.isArray(x) ? x[0] : x) : ""}">${fmt(x)}</span>`).join("") : '<span class="muted">없음</span>'}</p>`;
  $("#sugg").innerHTML = `<h2>고칠 곳 제안 (v${$("#cver").value} 기준)</h2>` +
    block("자주 틀린 태그", "검토에서 40% 이상 틀림. 뜻을 좁히거나 빼세요.", s.often_wrong, x => `${esc(x[0])} ${x[1]}/${x[2]}`) +
    block("흔들리는 태그", "같은 이미지인데 나왔다 안 나왔다 함. 뜻을 적어 주세요.", s.flickering, x => `${esc(x[0])} ${x[1]}`) +
    block("추가 후보 · 검토에서 빠졌다고 한 태그", "누르면 목록에 추가돼요.", s.add_from_review, x => `+ ${esc(x[0])} ${x[1]}`, true) +
    block("추가 후보 · 자유 태그에서 자주 나온 말", "누르면 목록에 추가돼요.", s.add_from_free, x => `+ ${esc(x[0])} ${x[1]}`, true) +
    block("한 번도 안 쓰인 태그", "빼거나 다른 태그와 합칠 후보.", s.unused, x => esc(x));
  document.querySelectorAll("#sugg [data-add]").forEach(el => { if (el.dataset.add) el.onclick = () => addTag(el.dataset.add, "추가"); });
}

// ---------- boot ----------
(async () => { await refresh(); drawImgs(); if (S.job && S.job.running) poll(); })();
