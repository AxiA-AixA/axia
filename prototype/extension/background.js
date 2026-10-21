// Axia로 보내기 · 백그라운드: 우클릭 메뉴, Axia 앱(내 컴퓨터)으로 전송, 알림
const AXIA = "http://localhost:8770";
const ICON = "icon128.png";

async function inject(tabId) {
  try { await chrome.scripting.executeScript({target: {tabId}, files: ["content.js"]}); return true; } catch (e) { return false; }
}
chrome.runtime.onInstalled.addListener(async () => {
  // 설치 전에 열려 있던 탭에도 바로 동작하게 (새로고침 안 해도 됨)
  for (const t of await chrome.tabs.query({url: ["http://*/*", "https://*/*"]})) inject(t.id);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({id: "axia-send", title: "Axia로 보내기", contexts: ["image", "page", "link", "video"]});
    chrome.contextMenus.create({
      id: "axia-board", title: "이 Pinterest 보드 전체를 Axia로 보내기", contexts: ["page"],
      documentUrlPatterns: ["*://*.pinterest.com/*", "*://*.pinterest.co.uk/*", "*://*.pinterest.co.kr/*", "*://*.pinterest.de/*", "*://*.pinterest.fr/*"]
    });
    chrome.contextMenus.create({id: "axia-ig", title: "이 인스타 저장함 컬렉션 전체를 Axia로 보내기", contexts: ["page", "image", "link"],
      documentUrlPatterns: ["*://www.instagram.com/*/saved/*"]});
    chrome.contextMenus.create({id: "axia-ig-new", title: "인스타 저장함: 새로 저장한 것만 Axia로", contexts: ["page", "image", "link"],
      documentUrlPatterns: ["*://www.instagram.com/*/saved/*"]});
  });
});

function toast(title, message) {
  chrome.notifications.create({type: "basic", iconUrl: ICON, title, message, priority: 1});
}
function badge(text, color) {
  chrome.action.setBadgeText({text});
  if (color) chrome.action.setBadgeBackgroundColor({color});
}
async function post(path, body) {
  try {
    const r = await fetch(AXIA + path, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
    return await r.json();
  } catch (e) {
    return {error: "Axia 앱이 꺼져 있어요. 컴퓨터에서 Axia를 먼저 실행해 주세요."};
  }
}

async function sendOne(tab, info) {
  let item = null, noScript = false;
  try { item = await chrome.tabs.sendMessage(tab.id, {type: "AXIA_GET_IMAGE", fallbackSrc: info.srcUrl || null}); }
  catch (e) { noScript = true; }
  if (noScript && await inject(tab.id)) {
    try { item = await chrome.tabs.sendMessage(tab.id, {type: "AXIA_GET_IMAGE", fallbackSrc: info.srcUrl || null}); } catch (e) {}
  }
  if (!item && info.srcUrl && !info.srcUrl.startsWith("blob:")) item = {image_url: info.srcUrl, page_url: info.pageUrl, title: tab.title, source: new URL(info.pageUrl).hostname};
  if (!item) {
    const special = /^(chrome|edge|about|chrome-extension):/.test(info.pageUrl || "") || /chromewebstore|chrome\.google\.com\/webstore/.test(info.pageUrl || "");
    return toast("Axia", special ? "Chrome 설정·웹 스토어 같은 페이지에서는 보낼 수 없어요." :
      noScript ? "이 탭은 Axia 설치 전에 열린 탭이에요. 새로고침(F5) 후 다시 우클릭해 주세요." :
      "이 위치에서 이미지를 못 찾았어요. 이미지 정가운데에서 우클릭해 보세요.");
  }
  badge("…", "#555");
  const r = await post("/api/add", item);
  if (r.error) { badge("!", "#C00000"); return toast("Axia로 못 보냈어요", r.error); }
  badge("✓", "#1a7f37");
  setTimeout(() => badge(""), 2500);
  toast(r.new ? "Axia에 추가했어요" : "이미 Axia에 있는 이미지예요", r.new ? "분석이 끝나면 분야·태그가 붙어요." : "같은 이미지는 한 번만 저장해요.");
}

const boardState = {};
const KIND_NAME = {pin_board: "핀터레스트 보드", ig_saved: "인스타 저장함"};
async function startCollect(tabId, onlyNew = false) {
  const ping = await fetch(AXIA + "/api/ping").then(r => r.json()).catch(() => null);
  if (!ping) return toast("Axia로 못 보냈어요", "Axia 앱이 꺼져 있어요. 컴퓨터에서 Axia를 먼저 실행해 주세요.");
  let r = null;
  try { r = await chrome.tabs.sendMessage(tabId, {type: "AXIA_COLLECT", onlyNew}); }
  catch (e) { if (await inject(tabId)) { try { r = await chrome.tabs.sendMessage(tabId, {type: "AXIA_COLLECT", onlyNew}); } catch (e2) {} } }
  if (!r) return toast("Axia", "이 탭을 새로고침(F5)한 뒤 다시 해 주세요.");
  if (r.error === "landing") return toast("컬렉션을 먼저 여세요", "저장함 첫 화면이 아니라 '모든 게시물'이나 원하는 컬렉션을 연 다음 다시 눌러 주세요.");
  if (r.error) return toast("Axia", "핀터레스트 보드나 인스타 저장함 컬렉션 페이지에서만 쓸 수 있어요.");
  boardState[tabId] = {kind: r.kind, added: 0, fresh: 0, failed: 0, found: 0, running: true, onlyNew};
  chrome.storage.session.set({board: boardState[tabId]});
  badge("0", "#2f4bff");
  toast(`${KIND_NAME[r.kind]} 가져오는 중`, "이 탭을 화면에 띄워 두세요(다른 탭으로 가면 멈춰요). 끝나면 알려 드릴게요.");
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "axia-send") sendOne(tab, info);
  if (info.menuItemId === "axia-board" || info.menuItemId === "axia-ig") startCollect(tab.id);
  if (info.menuItemId === "axia-ig-new") startCollect(tab.id, true);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab && sender.tab.id;
  if (msg.type === "AXIA_PROGRESS" && tabId != null) {
    badge(String(msg.n), "#2f4bff");
    const st = boardState[tabId];
    if (st) { st.found = msg.n; st.paused = false; chrome.storage.session.set({board: st}); }
  }
  if (msg.type === "AXIA_PAUSED" && tabId != null) {
    badge("II", "#C00000");
    const st = boardState[tabId];
    if (st && !st.pausedNotified) { st.pausedNotified = true; toast("가져오기 일시정지", "탭이 가려져서 멈췄어요. 그 탭으로 돌아가면 이어서 해요."); }
  }
  if (msg.type === "AXIA_BATCH" && tabId != null) {
    (async () => {
      const st = boardState[tabId] || (boardState[tabId] = {kind: msg.kind, added: 0, fresh: 0, failed: 0, found: 0, running: true});
      st.found = msg.total;
      let fresh = null;
      if (msg.items.length) {
        const r = await post("/api/add_batch", {items: msg.items});
        if (r.error) { st.failed += msg.items.length; st.error = r.error; }
        else { st.added += r.added; st.fresh += r.new; st.failed += r.failed; fresh = r.new; }
      }
      if (msg.final) {
        st.running = false;
        badge("✓", "#1a7f37");
        toast(`${KIND_NAME[st.kind] || "목록"} 가져오기 완료`, st.error ? st.error : `${st.found}개 → Axia에 ${st.added}장 (새로 ${st.fresh}장${st.failed ? `, 실패 ${st.failed}장` : ""})`);
      }
      chrome.storage.session.set({board: st});
      reply({ok: true, new: fresh});
    })();
    return true;
  }
  if (msg.type === "POPUP_COLLECT") { startCollect(msg.tabId, !!msg.onlyNew); reply({ok: true}); }
  if (msg.type === "POPUP_PAGE") {
    (async () => {
      const r = await post("/api/add", msg.item);
      reply(r);
    })();
    return true;
  }
});
