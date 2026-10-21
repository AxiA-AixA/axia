const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const api = (p, body) => fetch(p, body === undefined ? {} : {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}).then(r => r.json());
const FIELD_KO = {"3d": "3D", graphic: "그래픽", typography: "타이포그래피", painting: "회화", photo: "사진", package: "패키지", video: "영상", ui_ux: "UI/UX", spatial: "공간", editorial: "편집", ai_image: "AI 이미지"};
const fk = f => FIELD_KO[f] || f || "미분류";
let L = {items: []}, view = "grid", filt = {state: "all", field: null, src: null, col: null, tag: null, q: ""}, lastSig = "";

async function load() {
  L = await api("/api/library");
  const sig = JSON.stringify([L.items.length, L.items.map(i => i.status + i.id).join(), L.queue]);
  const st = L.status || {};
  const busy = L.queue || st.working;
  $("#status").textContent = busy ? `분석 중 · 대기 ${L.queue}장${st.note ? " · " + st.note : ""}` : `${L.items.length}장 보관 중`;
  if (sig !== lastSig) { lastSig = sig; draw(); }
  setTimeout(load, busy ? 1500 : 5000);
}

function tagsOf(it) { return [...(it.user_tags || []), ...(it.tags || [])]; }
function pass(it, skip) {
  if (skip !== "state") {
    if (filt.state === "queued" && !["queued", "retry", "new"].includes(it.status)) return false;
    if (filt.state === "failed" && it.status !== "failed") return false;
  }
  if (skip !== "field" && filt.field && (it.field || "미분류") !== filt.field) return false;
  if (skip !== "src" && filt.src && it.source !== filt.src) return false;
  if (skip !== "col" && filt.col && !(it.collections || []).includes(filt.col)) return false;
  if (skip !== "tag" && filt.tag && !tagsOf(it).includes(filt.tag)) return false;
  if (filt.q) { const q = filt.q.toLowerCase(); if (!(tagsOf(it).join(" ") + " " + (it.title || "") + " " + (it.group_name || "") + " " + (it.field || "")).toLowerCase().includes(q)) return false; }
  return true;
}
function counts(key, skip) {
  const c = {};
  L.items.filter(i => pass(i, skip)).forEach(i => { const k = key(i); c[k] = (c[k] || 0) + 1; });
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}
function nav(el, list, cur, set, label = x => x) {
  el.innerHTML = `<a class="${cur == null ? "on" : ""}" data-v="">전체<span></span></a>` + list.map(([k, n]) => `<a class="${cur === k ? "on" : ""}" data-v="${esc(k)}">${esc(label(k))}<span>${n}</span></a>`).join("");
  el.querySelectorAll("a").forEach(a => a.onclick = () => { set(a.dataset.v || null); draw(); });
}

function draw() {
  const items = L.items.filter(i => pass(i));
  const q = L.items.filter(i => ["queued", "retry", "new"].includes(i.status)).length, f = L.items.filter(i => i.status === "failed").length;
  $("#navstate").innerHTML = [["all", "전체", L.items.length], ["queued", "분석 대기", q], ["failed", "분석 실패", f]].map(([k, l, n]) => `<a class="${filt.state === k ? "on" : ""}" data-v="${k}">${l}<span>${n}</span></a>`).join("");
  $("#navstate").querySelectorAll("a").forEach(a => a.onclick = () => { filt.state = a.dataset.v; draw(); });
  nav($("#navfield"), counts(i => i.field || "미분류", "field"), filt.field, v => filt.field = v, fk);
  nav($("#navsrc"), counts(i => i.source || "기타", "src"), filt.src, v => filt.src = v);
  const cc = {};
  L.items.filter(i => pass(i, "col")).forEach(i => (i.collections || []).forEach(c => cc[c] = (cc[c] || 0) + 1));
  const cols = Object.entries(cc).sort((a, b) => b[1] - a[1]);
  $("#navcolwrap").style.display = cols.length ? "" : "none";
  nav($("#navcol"), cols, filt.col, v => filt.col = v);
  const tc = {};
  items.forEach(i => tagsOf(i).forEach(t => tc[t] = (tc[t] || 0) + 1));
  $("#navtags").innerHTML = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t, n]) => `<span class="${filt.tag === t ? "on" : ""}" data-t="${esc(t)}">${esc(t)} ${n}</span>`).join("") || '<span class="tags">아직 없음</span>';
  $("#navtags").querySelectorAll("[data-t]").forEach(s => s.onclick = () => { filt.tag = filt.tag === s.dataset.t ? null : s.dataset.t; draw(); });
  $("#count").textContent = `${items.length}장`;

  if (!L.items.length) {
    $("#out").innerHTML = `<div class="empty"><p><b>아직 보관한 레퍼런스가 없어요.</b></p><p>Chrome에서 이미지를 우클릭 → <b>Axia로 보내기</b><br>핀터레스트 보드에서는 확장 아이콘 → <b>이 보드 전체 보내기</b><br>또는 위 칸에 링크를 붙여넣거나, 이미지 파일을 이 화면에 끌어다 놓으세요.</p></div>`;
    return;
  }
  if (view === "graph") {
    Graph.render($("#out"), items);
    return;
  }
  if (view === "grid") {
    $("#out").innerHTML = `<div class="grid">${items.map(card).join("")}</div>`;
  } else {
    const key = view === "group" ? (i => i.group_name || "(그룹 없음)") : (i => fk(i.field));
    const g = {};
    items.forEach(i => (g[key(i)] = g[key(i)] || []).push(i));
    $("#out").innerHTML = Object.entries(g).sort((a, b) => b[1].length - a[1].length).map(([k, arr]) => `<div class="group"><h3>${esc(k)} <span>${arr.length}</span></h3><div class="groupgrid">${arr.map(i => `<img loading="lazy" src="/img/${i.file}" data-id="${i.id}">`).join("")}</div></div>`).join("");
  }
  document.querySelectorAll("[data-id]").forEach(el => el.onclick = () => openDetail(el.dataset.id));
}
function card(i) {
  const badge = i.status === "tagged" ? `<span class="badge">${esc(fk(i.field))}</span>` : i.status === "failed" ? '<span class="badge f">실패</span>' : '<span class="badge q">분석 중</span>';
  return `<div class="card" data-id="${i.id}"><img loading="lazy" src="/img/${i.file}"><div class="meta">${badge}<span class="src">${esc(i.source || "")}</span><div class="tags">${esc(tagsOf(i).slice(0, 6).join(" · "))}</div></div></div>`;
}

function openDetail(id) {
  const i = L.items.find(x => x.id === id);
  if (!i) return;
  const d = $("#detail");
  const fields = [...new Set([...(L.fields || []), i.field].filter(Boolean))];
  d.innerHTML = `<div class="dlg"><div class="pic"><img src="/img/${i.file}"></div><div class="side">
    <div class="row" style="justify-content:space-between"><b>${esc(i.title || "제목 없음")}</b><button class="ghost" id="dclose">닫기</button></div>
    ${i.page_url ? `<p class="tags"><a href="${esc(i.page_url)}" target="_blank" rel="noopener">원본 열기 (${esc(i.source)})</a></p>` : ""}
    ${i.status === "failed" ? `<div class="note">분석 실패: ${esc(i.error || "")}</div>` : ""}
    <label>분야</label><select id="dfield">${fields.map(f => `<option value="${esc(f)}" ${f === i.field ? "selected" : ""}>${esc(fk(f))}</option>`).join("")}</select>
    <label>AI 태그</label><div class="chips">${(i.tags || []).map(t => `<span data-t="${esc(t)}">${esc(t)}</span>`).join("") || '<span class="tags">없음</span>'}</div>
    <label>내 태그 (쉼표로 구분)</label><input id="dtags" value="${esc((i.user_tags || []).join(", "))}">
    <label>그룹</label><input id="dgroup" value="${esc(i.group_name || "")}">
    ${(i.collections || []).length ? `<p class="tags">인스타 컬렉션: ${esc(i.collections.join(", "))}</p>` : ""}
    <p class="tags" style="margin-top:14px">추가 ${esc(i.added)}${i.model ? ` · ${esc(i.model)} · ${i.latency_ms}ms` : ""}</p>
    <div class="row" style="margin-top:14px"><button class="primary" id="dsave">저장</button><button id="dretag">다시 분석</button><button class="ghost" id="ddel" style="color:var(--bad)">삭제</button></div>
  </div></div>`;
  d.showModal();
  $("#dclose").onclick = () => d.close();
  d.querySelectorAll(".chips [data-t]").forEach(s => s.onclick = () => { filt.tag = s.dataset.t; d.close(); draw(); });
  $("#dsave").onclick = async () => { await api("/api/item", {id, field: $("#dfield").value, user_tags: $("#dtags").value.split(",").map(s => s.trim()).filter(Boolean), group_name: $("#dgroup").value}); d.close(); lastSig = ""; load(); };
  $("#dretag").onclick = async () => { await api("/api/retag", {ids: [id]}); d.close(); lastSig = ""; };
  $("#ddel").onclick = async () => { if (confirm("이 레퍼런스를 Axia에서 지울까요?")) { await api("/api/item", {id, delete: true}); d.close(); lastSig = ""; } };
}

// ---- adding ----
async function addLink(url) {
  $("#status").textContent = "가져오는 중…";
  const r = await api("/api/add_link", {url});
  $("#status").textContent = r.error ? "못 가져왔어요: " + r.error : `${r.added}장 추가 (새로 ${r.new}장)`;
  lastSig = "";
}
$("#addlink").onclick = () => { const v = $("#link").value.trim(); if (v) { addLink(v); $("#link").value = ""; } };
$("#link").onkeydown = e => { if (e.key === "Enter") $("#addlink").click(); };
$("#pick").onclick = () => $("#files").click();
$("#files").onchange = e => uploadFiles(e.target.files);
async function uploadFiles(files) {
  let n = 0;
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    $("#status").textContent = `올리는 중 ${++n}/${files.length}`;
    await fetch("/api/upload?name=" + encodeURIComponent(f.name), {method: "POST", body: f});
  }
  lastSig = "";
}
$("#pickjson").onclick = () => $("#jsonfile").click();
$("#jsonfile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  $("#status").textContent = "인스타 JSON 가져오는 중… (장수가 많으면 몇 분 걸려요)";
  const r = await api("/api/import_json", JSON.parse(await f.text()));
  $("#status").textContent = r.error ? r.error : `${r.added}장 추가 (새로 ${r.new}장, 실패 ${r.failed}장 — 실패는 대개 썸네일 주소 만료)`;
  lastSig = "";
};
document.addEventListener("dragover", e => { e.preventDefault(); document.body.classList.add("drag"); });
document.addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("drag"); });
document.addEventListener("drop", e => {
  e.preventDefault(); document.body.classList.remove("drag");
  if (e.dataTransfer.files.length) return uploadFiles(e.dataTransfer.files);
  const url = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").split("\n")[0].trim();
  if (url) addLink(url);
});

// ---- view / search ----
document.querySelectorAll(".seg button[data-v]").forEach(b => b.onclick = () => { view = b.dataset.v; document.querySelectorAll(".seg button[data-v]").forEach(x => x.classList.toggle("on", x === b)); draw(); });
$("#q").oninput = e => { filt.q = e.target.value.trim(); draw(); };

// ---- settings ----
let chain = [];
async function openSettings() {
  const s = await api("/api/settings");
  chain = s.chain;
  drawChain();
  ["gemini", "anthropic", "openai"].forEach(p => { $("#k_" + p).value = ""; $("#ks_" + p).textContent = s.keys[p] ? "저장됨" : "없음"; });
  $("#mode").value = s.mode; $("#auto").checked = s.auto_tag;
  $("#settings").showModal();
}
function drawChain() {
  $("#chain").innerHTML = chain.map((c, i) => `<div class="chain" data-i="${i}"><b>${i + 1}</b><select data-k="provider">${["gemini", "anthropic", "openai", "mock"].map(p => `<option ${p === c.provider ? "selected" : ""}>${p}</option>`).join("")}</select><input data-k="model" value="${esc(c.model)}"><div><button class="ghost" data-up>↑</button><button class="ghost" data-del>×</button></div></div>`).join("");
  $("#chain").querySelectorAll(".chain").forEach(row => {
    const i = +row.dataset.i;
    row.querySelectorAll("[data-k]").forEach(el => el.oninput = () => chain[i][el.dataset.k] = el.value);
    row.querySelector("[data-up]").onclick = () => { if (i) { [chain[i - 1], chain[i]] = [chain[i], chain[i - 1]]; drawChain(); } };
    row.querySelector("[data-del]").onclick = () => { chain.splice(i, 1); drawChain(); };
  });
}
$("#addstep").onclick = () => { chain.push({provider: "gemini", model: ""}); drawChain(); };
$("#opensettings").onclick = openSettings;
$("#closeset").onclick = () => $("#settings").close();
$("#saveset").onclick = async () => {
  const keys = {};
  ["gemini", "anthropic", "openai"].forEach(p => { const v = $("#k_" + p).value.trim(); if (v) keys[p] = v; });
  await api("/api/settings", {chain: chain.filter(c => c.model), keys, mode: $("#mode").value, auto_tag: $("#auto").checked});
  $("#settings").close();
};
$("#retryfail").onclick = async () => { const r = await api("/api/retag", {statuses: ["failed", "new"]}); $("#settings").close(); $("#status").textContent = `${r.queued}장 다시 분석`; lastSig = ""; };

load();
