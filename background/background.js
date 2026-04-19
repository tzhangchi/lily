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
  return downloadTextFile(filename, csv, "text/csv;charset=utf-8");
}

async function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const url = `data:${mimeType},${encodeURIComponent(content)}`;
  return chrome.downloads.download({ url, filename, saveAs: false });
}

function safeFilenamePart(value, fallback = "page") {
  const s = (value || fallback)
    .toString()
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return s || fallback;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("找不到当前标签页");
  return tab;
}

async function analyzeActiveTab() {
  const tab = await getActiveTab();
  const settings = await getSettings();

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type: "LR_ANALYZE_PAGE", settings });
  } catch (e) {
    const msg = e?.message || String(e);
    const url = tab.url || "";
    const restricted =
      url.startsWith("chrome://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("https://chrome.google.com/webstore") ||
      url.startsWith("https://chromewebstore.google.com/");

    // 关键：Receiving end does not exist => 目标页面没有注入 content script
    if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      console.warn("[Lily] sendMessage failed (no receiver). url=", url, "restricted=", restricted, "err=", msg);
      if (restricted) {
        throw new Error("这是 Chrome 限制页面，内容脚本无法运行（请在普通网页使用）。");
      }
      throw new Error("内容脚本未就绪/未注入：请刷新页面后再试（或重新打开该标签页）。");
    }
    console.warn("[Lily] sendMessage failed. url=", url, "err=", msg);
    throw new Error(msg);
  }
  // AI 增强（可选）：失败不影响主流程
  if (settings.aiEnabled) {
    try {
      const ai = await aiEnhance(result, settings);
      return { ...result, ai };
    } catch {
      // ignore
    }
  }
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
      if (msg?.type === "LR_EXPORT_MARKDOWN") {
        const analysis = msg.analysis || {};
        const built = await buildMarkdownForExport(analysis);
        const markdown = built.markdown || "";
        if (!markdown) throw new Error("当前页面没有可导出的 Markdown，请先分析页面");
        const domain = safeFilenamePart(analysis.domain || "page");
        const title = safeFilenamePart(analysis.title || "analysis");
        const file = msg.filename || `link-radar-${domain}-${title}-${new Date().toISOString().slice(0, 10)}.md`;
        const downloadId = await downloadTextFile(file, markdown, "text/markdown;charset=utf-8");
        sendResponse({ ok: true, aiUsed: built.aiUsed, fallbackReason: built.fallbackReason || "", downloadId });
        return;
      }
      if (msg?.type === "LR_BUILD_MARKDOWN") {
        const built = await buildMarkdownForExport(msg.analysis || {});
        if (!built.markdown) throw new Error("当前页面没有可复制的 Markdown，请先分析页面");
        sendResponse({ ok: true, ...built });
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

// ===== Side Panel（全高度展开）=====
// 说明：Chrome action popup 有高度上限；使用 sidePanel 才能实现类似截图的“固定宽度 + h-screen”体验。
try {
  chrome.runtime.onInstalled?.addListener(() => {
    // 新版 Chrome 支持：点击扩展图标自动打开 side panel
    chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
  });

  // 兼容：如果 setPanelBehavior 不可用，则用 onClicked 手动打开
  chrome.action?.onClicked?.addListener(async (tab) => {
    try {
      if (tab?.windowId != null) await chrome.sidePanel?.open?.({ windowId: tab.windowId });
    } catch {
      // ignore
    }
  });
} catch {
  // ignore
}

async function aiEnhance(analysis, settings) {
  const base = (settings.aiServerUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("aiServerUrl missing");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    // 控制 payload：只取前 30 条链接
    const slim = {
      url: analysis.url,
      title: analysis.title,
      domain: analysis.domain,
      pageType: analysis.pageType,
      score: analysis.score,
      totalLinks: analysis.totalLinks,
      contentLinks: analysis.contentLinks,
      competitorMentions: analysis.competitorMentions,
      commercialSignals: analysis.commercialSignals,
      seo: analysis.seo,
      textSample: analysis.textSample,
      links: (analysis.links || []).slice(0, 30).map((l) => ({
        url: l.url,
        domain: l.domain,
        anchorText: l.anchorText,
        location: l.location,
        category: l.category,
        isCompetitor: l.isCompetitor,
        isNofollow: l.isNofollow,
        isSponsored: l.isSponsored,
        contextText: l.contextText
      }))
    };

    const res = await fetch(`${base}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ analysis: slim, model: settings.aiModel || "gpt-4.1" }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`ai server http ${res.status}`);
    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error || "ai server error");
    return json.ai;
  } finally {
    clearTimeout(timer);
  }
}

async function buildMarkdownForExport(analysis) {
  const settings = await getSettings();
  const fallback = analysis.pageBrief?.markdown || analysis.markdown || "";
  if (!settings.aiEnabled) return { markdown: fallback, aiUsed: false, fallbackReason: "AI 未启用" };

  try {
    const aiMarkdown = await aiBuildMarkdown(analysis, settings);
    if (aiMarkdown) return { markdown: aiMarkdown, aiUsed: true };
  } catch (e) {
    return {
      markdown: fallback,
      aiUsed: false,
      fallbackReason: e?.message || String(e)
    };
  }
  return { markdown: fallback, aiUsed: false, fallbackReason: "AI 未返回 Markdown" };
}

async function aiBuildMarkdown(analysis, settings) {
  const base = (settings.aiServerUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("aiServerUrl missing");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const slim = slimAnalysisForAi(analysis, { includePageBrief: true, linkLimit: 35 });
    const res = await fetch(`${base}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ analysis: slim, model: settings.aiModel || "gpt-4.1", mode: "markdownExport" }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`ai server http ${res.status}`);
    const json = await res.json();
    if (!json?.ok) throw new Error(json?.error || "ai server error");
    return (json.ai?.markdown || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

function slimAnalysisForAi(analysis, { includePageBrief = false, linkLimit = 30 } = {}) {
  const slim = {
    url: analysis.url,
    title: analysis.title,
    domain: analysis.domain,
    pageType: analysis.pageType,
    score: analysis.score,
    totalLinks: analysis.totalLinks,
    contentLinks: analysis.contentLinks,
    competitorMentions: analysis.competitorMentions,
    commercialSignals: analysis.commercialSignals,
    summary: analysis.summary,
    insights: analysis.insights,
    ai: analysis.ai,
    seo: analysis.seo,
    textSample: analysis.textSample,
    links: (analysis.links || []).slice(0, linkLimit).map((l) => ({
      url: l.url,
      domain: l.domain,
      anchorText: l.anchorText,
      location: l.location,
      category: l.category,
      isCompetitor: l.isCompetitor,
      isNofollow: l.isNofollow,
      isSponsored: l.isSponsored,
      contextText: l.contextText
    }))
  };
  if (includePageBrief) {
    const pageBrief = analysis.pageBrief || {};
    slim.pageBrief = {
      highlights: pageBrief.highlights,
      discountBanners: pageBrief.discountBanners,
      freeButtons: pageBrief.freeButtons,
      ctas: pageBrief.ctas,
      headings: pageBrief.headings,
      pageSwitches: pageBrief.pageSwitches,
      defaultModels: pageBrief.defaultModels,
      examples: pageBrief.examples,
      generationHistory: pageBrief.generationHistory,
      sidebarFeatures: pageBrief.sidebarFeatures,
      navItems: pageBrief.navItems,
      forms: pageBrief.forms,
      trustSignals: pageBrief.trustSignals,
      images: pageBrief.images,
      visualStyle: pageBrief.visualStyle,
      sectionTree: pageBrief.sectionTree,
      structure: pageBrief.structure
    };
  }
  return slim;
}
