// Axia로 보내기 · 페이지 안에서 하는 일
// 1) 우클릭한 위치 아래의 이미지를 찾아요 (인스타처럼 이미지 위에 투명한 막이 덮여 있어도 찾음)
// 2) 핀터레스트 보드를 스크롤하며 핀을 모아요

if (window.__axiaLoaded) { /* 이미 들어가 있음 */ } else {
window.__axiaLoaded = true;
let lastPoint = null;
document.addEventListener("contextmenu", e => { lastPoint = {x: e.clientX, y: e.clientY}; }, true);

function bestSrc(img) {
  // srcset 중 가장 큰 이미지
  let best = img.currentSrc || img.src, bestW = 0;
  (img.srcset || "").split(",").forEach(part => {
    const [u, w] = part.trim().split(/\s+/);
    const n = parseInt(w) || 0;
    if (u && n > bestW) { best = u; bestW = n; }
  });
  return upgrade(best);
}
function upgrade(u) {
  if (!u) return u;
  if (!/^(data|blob):/.test(u)) { try { u = new URL(u, location.href).href; } catch (e) {} }
  // 핀터레스트 썸네일 → 큰 이미지
  return u.replace(/i\.pinimg\.com\/(\d+x|\d+x\d+)\//, "i.pinimg.com/736x/");
}
function bgImage(el) {
  const m = getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
  return m ? m[1] : null;
}
function imageAt(pt) {
  if (!pt) return null;
  for (const el of document.elementsFromPoint(pt.x, pt.y)) {
    if (el.tagName === "IMG" && (el.naturalWidth || el.width) > 40) return {src: bestSrc(el), el};
    if (el.tagName === "VIDEO" && el.poster) return {src: el.poster, el};
    const bg = bgImage(el);
    if (bg && !bg.startsWith("data:image/svg")) return {src: bg, el};
  }
  // 이미지가 클릭을 안 받도록 막혀 있는 사이트(pointer-events:none): 위치로 직접 찾기
  let best = null, bestArea = Infinity;
  for (const img of document.images) {
    const r = img.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    if (pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom) {
      const area = r.width * r.height;
      if (area < bestArea) { best = img; bestArea = area; }
    }
  }
  return best ? {src: bestSrc(best), el: best} : null;
}
function pageLinkFor(el) {
  const a = el && el.closest("a[href*='/p/'], a[href*='/reel/'], a[href*='/pin/'], a[href*='/gallery/'], a[href*='/shots/']");
  return a ? a.href : location.href;
}
function og(prop) {
  const m = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
  return m ? m.content : "";
}
async function toDataUrl(src) {
  const blob = await (await fetch(src)).blob();
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}

async function getImage(fallbackSrc) {
  const hit = imageAt(lastPoint);
  let src = hit ? hit.src : fallbackSrc;
  let page = hit ? pageLinkFor(hit.el) : location.href;
  if (!src) { src = upgrade(og("og:image")); page = location.href; }
  if (!src) return null;
  if (src.startsWith("blob:")) { try { src = await toDataUrl(src); } catch (e) { return null; } }
  const alt = hit && hit.el.alt ? hit.el.alt : "";
  return {image_url: src, page_url: page, title: (alt || og("og:title") || document.title).slice(0, 200), source: location.hostname.replace("www.", "")};
}

// ---- 목록 통째로 보내기: 핀터레스트 보드 / 인스타 저장함(컬렉션) ----
// 로그인한 내 브라우저 안에서 페이지를 스크롤하며 모아요. 비밀번호나 쿠키를 Axia 앱에 넘기지 않아요.
let collecting = false;
function cutoffY() {
  // 보드 끝 아래의 "추천 핀(More ideas)" 영역은 빼요
  for (const h of document.querySelectorAll("h2, h3, [role='heading']")) {
    if (/more ideas|find more|more like this|아이디어 더|더 많은 아이디어|비슷한/i.test(h.textContent || "")) return h.getBoundingClientRect().top + scrollY;
  }
  return Infinity;
}
function pageKind() {
  const h = location.hostname, p = location.pathname;
  if (/instagram\.com$/.test(h) && /\/saved(\/|$)/.test(p)) {
    const parts = p.split("/").filter(Boolean);           // [user, saved, slug?, id?]
    return parts.length >= 3 ? "ig_saved" : "ig_saved_landing";
  }
  if (/pinterest\./.test(h) && !/\/pin\//.test(p) && p.split("/").filter(Boolean).length >= 2) return "pin_board";
  return null;
}
function igCollectionName() {
  const parts = location.pathname.split("/").filter(Boolean);
  return parts[2] === "all-posts" ? "전체" : decodeURIComponent(parts[2] || "");
}
function scroller() {
  // 인스타는 창이 아니라 안쪽 상자가 스크롤되는 경우가 있어요
  const se = document.scrollingElement;
  if (se.scrollHeight > innerHeight + 50) return se;
  let best = se, bestH = 0;
  document.querySelectorAll("main, div").forEach(el => {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 50 && el.clientHeight > bestH) { best = el; bestH = el.clientHeight; }
  });
  return best;
}
function grab(kind, seen, limit, cut) {
  if (kind === "pin_board") {
    document.querySelectorAll("a[href*='/pin/']").forEach(a => {
      const img = a.querySelector("img[src*='pinimg.com']");
      if (!img || a.getBoundingClientRect().top + scrollY > cut) return;
      const href = a.href.split("?")[0];
      if (!seen.has(href) && seen.size < limit) seen.set(href, {image_url: bestSrc(img), page_url: href, title: (img.alt || "").slice(0, 200), source: "pinterest"});
    });
  } else {
    const col = igCollectionName();
    document.querySelectorAll("main a[href*='/p/'], main a[href*='/reel/']").forEach(a => {
      const img = a.querySelector("img");
      if (!img || !(img.currentSrc || img.src)) return;
      const m = a.href.match(/\/(p|reel)\/([^/?#]+)/);
      if (!m) return;
      const href = `https://www.instagram.com/${m[1]}/${m[2]}/`;
      if (!seen.has(href) && seen.size < limit) seen.set(href, {image_url: bestSrc(img), page_url: href, title: (img.alt || "").slice(0, 200), source: "instagram", collection: col});
    });
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function collect(kind, {limit = 500, onlyNew = false} = {}) {
  if (collecting) return;
  collecting = true;
  const seen = new Map();
  let idle = 0, sentUpTo = 0, knownStreak = 0;
  const isIG = kind === "ig_saved";
  const flush = async (final) => {
    const all = [...seen.values()];
    const batch = all.slice(sentUpTo);
    if (!(batch.length && (final || batch.length >= 25)) && !final) return;
    sentUpTo = all.length;
    const r = await chrome.runtime.sendMessage({type: "AXIA_BATCH", kind, items: batch, total: all.length, final});
    if (batch.length && r && r.new === 0) knownStreak += batch.length; else if (r && r.new) knownStreak = 0;
  };
  const sc = scroller();
  sc.scrollTo(0, 0);
  await sleep(1000);
  while (seen.size < limit && idle < (isIG ? 10 : 6)) {
    if (document.hidden) {             // 탭이 가려지면 인스타·핀터레스트가 로딩을 멈춰요 → 다시 보일 때까지 대기
      chrome.runtime.sendMessage({type: "AXIA_PAUSED"});
      while (document.hidden) await sleep(1000);
    }
    const cut = kind === "pin_board" ? cutoffY() : Infinity;
    const before = seen.size;
    grab(kind, seen, limit, cut);
    idle = seen.size === before ? idle + 1 : 0;
    chrome.runtime.sendMessage({type: "AXIA_PROGRESS", n: seen.size});
    await flush(false);
    if (onlyNew && knownStreak >= 50) break;          // 새 저장분만: 이미 있는 게 50개 연속이면 멈춤
    if (cut !== Infinity && scrollY + innerHeight > cut) break;
    if (idle && idle % 3 === 0) { sc.scrollBy(0, -innerHeight); await sleep(600); }   // 끝처럼 보이면 살짝 올렸다 내려 로딩 깨우기
    sc.scrollBy(0, innerHeight * 0.85);
    await sleep((isIG ? 1500 : 1200) + Math.random() * 600);
  }
  await flush(true);
  collecting = false;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "AXIA_GET_IMAGE") { getImage(msg.fallbackSrc).then(reply); return true; }
  if (msg.type === "AXIA_PAGE_INFO") {
    const kind = pageKind();
    reply({kind, isBoard: kind === "pin_board", collection: kind === "ig_saved" ? igCollectionName() : null, title: document.title, ogImage: upgrade(og("og:image"))});
    return;
  }
  if (msg.type === "AXIA_COLLECT") {
    const kind = pageKind();
    if (kind !== "ig_saved" && kind !== "pin_board") { reply({error: kind === "ig_saved_landing" ? "landing" : "unsupported"}); return; }
    collect(kind, {limit: msg.limit || (kind === "ig_saved" ? 10000 : 500), onlyNew: !!msg.onlyNew});
    reply({started: true, kind});
    return;
  }
});
}
