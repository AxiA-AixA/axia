const AXIA = "http://localhost:8770";
const $ = s => document.querySelector(s);

(async () => {
  const ping = await fetch(AXIA + "/api/ping").then(r => r.json()).catch(() => null);
  $("#st").className = "st " + (ping ? "ok" : "bad");
  $("#st").textContent = ping ? "Axia 앱과 연결됨" : "Axia 앱이 꺼져 있어요. 컴퓨터에서 Axia를 먼저 실행하세요.";
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  let info = null;
  try { info = await chrome.tabs.sendMessage(tab.id, {type: "AXIA_PAGE_INFO"}); } catch (e) {}
  if (info) {
    if (info.kind === "pin_board") $("#board").textContent = "이 Pinterest 보드 전체 보내기";
    if (info.kind === "ig_saved") { $("#board").textContent = `인스타 저장함 '${info.collection}' 전체 보내기`; $("#boardnew").style.display = "block"; }
    if (info.kind === "ig_saved_landing") $("#prog").textContent = "저장함 첫 화면이에요. '모든 게시물'이나 원하는 컬렉션을 열면 보낼 수 있어요.";
  }
  if (ping && info) {
    $("#board").disabled = !(info.kind === "pin_board" || info.kind === "ig_saved");
    $("#boardnew").disabled = info.kind !== "ig_saved";
    $("#page").disabled = !info.ogImage;
  }
  $("#board").onclick = async () => { await chrome.runtime.sendMessage({type: "POPUP_COLLECT", tabId: tab.id}); $("#prog").textContent = "모으는 중… 이 탭을 화면에 띄워 두세요."; };
  $("#boardnew").onclick = async () => { await chrome.runtime.sendMessage({type: "POPUP_COLLECT", tabId: tab.id, onlyNew: true}); $("#prog").textContent = "새로 저장한 것만 모으는 중…"; };
  $("#page").onclick = async () => {
    const r = await chrome.runtime.sendMessage({type: "POPUP_PAGE", item: {image_url: info.ogImage, page_url: tab.url, title: info.title, source: new URL(tab.url).hostname.replace("www.", "")}});
    $("#prog").textContent = r.error ? r.error : r.new ? "추가했어요." : "이미 있는 이미지예요.";
  };
  $("#open").onclick = () => chrome.tabs.create({url: AXIA});
  const {board} = await chrome.storage.session.get("board");
  if (board && !$("#prog").textContent) $("#prog").textContent = board.running ? `모으는 중: ${board.found}개` : `마지막 가져오기: ${board.added}장 (새로 ${board.fresh}장)`;
})();
