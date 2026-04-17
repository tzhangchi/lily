import { DEFAULT_SETTINGS } from "../shared/constants.js";
import { escapeCsvValue, nowIso } from "../shared/utils.js";

const STORAGE_KEYS = {
  settings: "lr_settings",
  saved: "lr_saved_pages" // { [url]: SavedPage }
};

async function getSettings() {
  const { [STORAGE_KEYS.settings]: settings } = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function setSettings(next) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.settings]: next });
}

async function getSavedPagesMap() {
  const { [STORAGE_KEYS.saved]: saved } = await chrome.storage.local.get(STORAGE_KEYS.saved);
  return saved || {};
}

async function upsertSavedPage(pageAnalysis, extra = {}) {
  const map = await getSavedPagesMap();
  const existing = map[pageAnalysis.url];
  map[pageAnalysis.url] = {
    url: pageAnalysis.url,
    title: pageAnalysis.title,
    domain: pageAnalysis.domain,
    pageType: pageAnalysis.pageType,
    score: pageAnalysis.score,
    totalLinks: pageAnalysis.totalLinks,
    contentLinks: pageAnalysis.contentLinks,
    competitorCount: (pageAnalysis.competitorMentions || []).length,
    commercialSignals: pageAnalysis.commercialSignals || [],
    summary: pageAnalysis.summary || "",
    insights: pageAnalysis.insights || [],
    tags: extra.tags ?? existing?.tags ?? [],
    status: extra.status ?? existing?.status ?? "未处理",
    notes: extra.notes ?? existing?.notes ?? "",
    savedAt: existing?.savedAt ?? nowIso(),
    updatedAt: nowIso(),
    // V1：为 CSV 导出保留轻量字段；详细外链列表不强制存（可选）
    links: extra.links ?? existing?.links ?? null
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.saved]: map });
  return map[pageAnalysis.url];
}

function toCsvRow(savedPage) {
  return [
    savedPage.url,
    savedPage.title,
    savedPage.domain,
    savedPage.pageType,
    savedPage.totalLinks,
    savedPage.contentLinks,
    savedPage.competitorCount,
    (savedPage.commercialSignals || []).join("|"),
    savedPage.score,
    (savedPage.tags || []).join("|"),
    savedPage.status,
    savedPage.notes,
    savedPage.savedAt,
    savedPage.updatedAt
  ].map(escapeCsvValue);
}

async function downloadCsv(filename, rows) {
  const header = [
    "页面URL",
    "页面标题",
    "域名",
    "页面类型",
    "外链数",
    "正文外链数",
    "竞品数",
    "商业痕迹",
    "机会评分",
    "标签",
    "状态",
    "备注",
    "保存时间",
    "更新时间"
  ];
  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("找不到当前标签页");
  return tab;
}

async function analyzeActiveTab() {
  const tab = await getActiveTab();
  const settings = await getSettings();

  const result = await chrome.tabs.sendMessage(tab.id, { type: "LR_ANALYZE_PAGE", settings });
  return result;
}

async function setHighlight(enabled) {
  const tab = await getActiveTab();
  const settings = await getSettings();
  await chrome.tabs.sendMessage(tab.id, { type: "LR_TOGGLE_HIGHLIGHT", enabled, settings });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "LR_GET_SETTINGS") {
        sendResponse({ ok: true, settings: await getSettings() });
        return;
      }
      if (msg?.type === "LR_SET_SETTINGS") {
        const next = { ...DEFAULT_SETTINGS, ...(msg.settings || {}) };
        await setSettings(next);
        sendResponse({ ok: true, settings: next });
        return;
      }
      if (msg?.type === "LR_ANALYZE_ACTIVE_TAB") {
        const analysis = await analyzeActiveTab();
        sendResponse({ ok: true, analysis });
        return;
      }
      if (msg?.type === "LR_TOGGLE_HIGHLIGHT") {
        await setHighlight(!!msg.enabled);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "LR_SAVE_PAGE") {
        const saved = await upsertSavedPage(msg.analysis, {
          tags: msg.tags,
          status: msg.status,
          notes: msg.notes
        });
        sendResponse({ ok: true, saved });
        return;
      }
      if (msg?.type === "LR_GET_HISTORY") {
        const map = await getSavedPagesMap();
        const list = Object.values(map)
          .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
          .slice(0, msg.limit ?? 10);
        sendResponse({ ok: true, list });
        return;
      }
      if (msg?.type === "LR_EXPORT_CSV") {
        const map = await getSavedPagesMap();
        const all = Object.values(map).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        const rows = all.map(toCsvRow);
        const file = msg.filename || `link-radar-export-${new Date().toISOString().slice(0, 10)}.csv`;
        await downloadCsv(file, rows);
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "未知消息类型" });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();

  // 告诉 Chrome：我们会异步调用 sendResponse
  return true;
});
