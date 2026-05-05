const GSC_STORAGE_KEYS = {
  submitJob: "lily_gsc_submit_job",
  reportJob: "lily_gsc_report_job"
};

const DEFAULT_PROPERTY = "sc-domain:llamagen.ai";
const DEFAULT_ALLOW_DOMAINS = ["llamagen.ai", "www.llamagen.ai"];
const DEFAULT_REPORT_URLS = [];
const DEFAULT_REPORT_FIELD_COUNT = 3;
const REPORT_URL_PLACEHOLDER = "留空则抓取当前已打开的 GSC 报告页";
const GSC_REPORT_DOWNLOAD_ROOT = "lily-gsc-reports";
const GSC_REPORT_DOWNLOAD_DISPLAY_ROOT = `Downloads/${GSC_REPORT_DOWNLOAD_ROOT}`;
const GSC_OPERATOR_SOURCE_UPDATED_AT = "2026-05-06 02:05 Asia/Shanghai";

const REQUEST_INDEXING_TEXTS = ["Request indexing", "请求编入索引"];
const CLOSE_TEXTS = ["Got it", "Close", "关闭", "完成"];
const DETAIL_TEXTS = ["View details", "Open report", "查看详情", "打开报告", "详情"];

let submitController = { stopped: false, paused: false };
let reportController = { stopped: false };

initGscPanel();

function initGscPanel() {
  const host = document.getElementById("sec-gsc");
  if (!host) return;
  host.innerHTML = renderGscUi();
  wireGscActions();
  restoreJobState();
}

function renderGscUi() {
  return `
    <div class="card">
      <h3>Lily GSC Operator</h3>
      <div class="small muted">Source updated: ${GSC_OPERATOR_SOURCE_UPDATED_AT} · Extension v${chrome.runtime.getManifest().version}</div>
      <div class="muted">
        自动辅助 Google Search Console URL Inspection 提交索引请求，并抓取核心报告 Markdown + 截图 + JSON 明细。
        插件不会绕过 Google 登录，也不保证收录；请保持低频使用，避免触发 GSC 配额。
      </div>
    </div>

    <div class="card">
      <h3>1. 自动提交 URL Inspection</h3>
      <div class="kv-list">
        <label class="kv">
          <div class="k">Property</div>
          <div class="v"><input id="gscProperty" class="input" value="${DEFAULT_PROPERTY}" /></div>
        </label>
        <label class="kv">
          <div class="k">Allow domains</div>
          <div class="v">
            <input id="gscAllowDomains" class="input" value="${DEFAULT_ALLOW_DOMAINS.join(", ")}" />
            <div class="hint">只提交这些域名下的 URL，用逗号分隔。</div>
          </div>
        </label>
      </div>
      <textarea id="gscUrlInput" class="input" style="min-height:140px;margin-top:10px;" placeholder="粘贴 sitemap URL、sitemap XML、或多个 URL。插件会自动提取 http/https URL。"></textarea>
      <div class="row" style="margin-top:10px;">
        <button id="gscParseUrls" class="btn btn-ghost">Parse URLs</button>
        <button id="gscStartSubmit" class="btn btn-primary">Start Submit</button>
        <button id="gscPauseSubmit" class="btn btn-ghost">Pause</button>
        <button id="gscResumeSubmit" class="btn btn-ghost">Resume</button>
        <button id="gscStopSubmit" class="btn btn-ghost">Stop</button>
        <button id="gscExportSubmitLog" class="btn btn-ghost">Export Log</button>
      </div>
      <div id="gscSubmitStatus" class="muted" style="margin-top:10px;">未开始</div>
      <div id="gscParsedUrls" class="small" style="margin-top:10px;max-height:180px;overflow:auto;"></div>
    </div>

    <div class="card">
      <h3>2. 抓取 GSC 核心报告</h3>
      <div class="kv-list">
        <label class="kv">
          <div class="k">Report URLs</div>
          <div class="v">
            <div id="gscReportUrlFields" class="gsc-report-url-fields">
              ${renderReportUrlFields(DEFAULT_REPORT_URLS)}
            </div>
            <div class="row" style="margin-top:8px;">
              <button id="gscAddReportUrl" class="btn btn-ghost" type="button">Add URL</button>
              <button id="gscUseCurrentReportUrl" class="btn btn-ghost" type="button">Use Current Tab</button>
            </div>
            <div class="hint">可配置多个报告 URL；执行时只复用当前页签依次跳转，不会新开页签。</div>
          </div>
        </label>
        <label class="kv">
          <div class="k">Options</div>
          <div class="v">
            <label class="small"><input id="gscCwvDrilldown" type="checkbox" checked /> Core Web Vitals drilldown</label>
            <label class="small"><input id="gscIndexingDrilldown" type="checkbox" checked /> Page Indexing drilldown</label>
            <label class="small"><input id="gscPerformanceDrilldown" type="checkbox" checked /> Performance Insights drilldown</label>
            <label class="small"><input id="gscAiReportSummary" type="checkbox" checked /> AI report summary when enabled</label>
            <label class="small"><input id="gscRecursiveDiscovery" type="checkbox" checked /> Recursive SEO/growth report discovery</label>
            <label class="small"><input id="gscIncludeDetails" type="checkbox" checked /> Include detail pages</label>
            <div class="row" style="margin-top:8px;">
              <input id="gscMaxDepth" class="input" style="max-width:120px;" type="number" min="0" max="3" value="2" />
              <input id="gscMaxPages" class="input" style="max-width:120px;" type="number" min="1" max="60" value="30" />
            </div>
            <div class="hint">请先在当前页签打开正确账号 / Property 的 GSC 报告。报告抓取只复用当前页签；从 Overview 开始时会递归发现 SEO / Growth 关键导航和卡片报告。默认下载到 Downloads/lily-gsc-reports/时间戳/，gsc-report-index.md 会汇总全部截图和明细数据。</div>
          </div>
        </label>
      </div>
      <div class="row" style="margin-top:10px;">
        <button id="gscStartReports" class="btn btn-primary">Capture Reports</button>
        <button id="gscStopReports" class="btn btn-ghost">Stop</button>
      </div>
      <div id="gscReportStatus" class="muted" style="margin-top:10px;">未开始</div>
      <div id="gscReportFiles" class="small" style="margin-top:10px;max-height:180px;overflow:auto;"></div>
    </div>
  `;
}

function wireGscActions() {
  on("gscParseUrls", "click", parseAndPreviewUrls);
  on("gscStartSubmit", "click", runSubmitJob);
  on("gscPauseSubmit", "click", () => {
    submitController.paused = true;
    setSubmitStatus("已暂停");
  });
  on("gscResumeSubmit", "click", () => {
    submitController.paused = false;
    setSubmitStatus("继续执行");
  });
  on("gscStopSubmit", "click", () => {
    submitController.stopped = true;
    submitController.paused = false;
    setSubmitStatus("正在停止…");
  });
  on("gscExportSubmitLog", "click", exportSubmitLog);
  on("gscAddReportUrl", "click", () => addReportUrlField(""));
  on("gscUseCurrentReportUrl", "click", fillCurrentReportUrl);
  document.getElementById("gscReportUrlFields")?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-gsc-remove-report-url]");
    if (!button) return;
    button.closest("[data-gsc-report-url-row]")?.remove();
    ensureReportUrlField();
    relabelReportUrlFields();
  });
  on("gscStartReports", "click", runReportCaptureJob);
  on("gscStopReports", "click", () => {
    reportController.stopped = true;
    setReportStatus("正在停止…");
  });
}

function on(id, event, handler) {
  document.getElementById(id)?.addEventListener(event, handler);
}

function renderReportUrlFields(urls) {
  const values = urls.length ? urls : Array.from({ length: DEFAULT_REPORT_FIELD_COUNT }, () => "");
  return values.map((url, index) => renderReportUrlField(url, index)).join("");
}

function renderReportUrlField(url, index) {
  return `
    <div class="gsc-report-url-row" data-gsc-report-url-row>
      <div class="gsc-report-url-label">Report URL ${index + 1}</div>
      <input class="input gsc-report-url-input" type="url" value="${escapeHtml(url)}" placeholder="${REPORT_URL_PLACEHOLDER}" />
      <button class="btn btn-ghost gsc-report-url-remove" type="button" data-gsc-remove-report-url>Remove</button>
    </div>
  `;
}

function addReportUrlField(url) {
  const host = document.getElementById("gscReportUrlFields");
  if (!host) return;
  const index = host.querySelectorAll("[data-gsc-report-url-row]").length;
  host.insertAdjacentHTML("beforeend", renderReportUrlField(url, index));
  relabelReportUrlFields();
}

function ensureReportUrlField() {
  const host = document.getElementById("gscReportUrlFields");
  if (host && !host.querySelector("[data-gsc-report-url-row]")) addReportUrlField("");
}

function setReportUrlFields(urls) {
  const host = document.getElementById("gscReportUrlFields");
  if (!host) return;
  host.innerHTML = renderReportUrlFields(urls || []);
  relabelReportUrlFields();
}

function relabelReportUrlFields() {
  document.querySelectorAll("#gscReportUrlFields .gsc-report-url-label").forEach((label, index) => {
    label.textContent = `Report URL ${index + 1}`;
  });
}

async function fillCurrentReportUrl() {
  const tab = await getActiveTab();
  const url = normalizeUrl(tab?.url || "");
  if (!url) return setReportStatus("当前页签没有可用 URL");
  let input = Array.from(document.querySelectorAll("#gscReportUrlFields .gsc-report-url-input")).find((el) => !el.value.trim());
  if (!input) {
    addReportUrlField("");
    const inputs = document.querySelectorAll("#gscReportUrlFields .gsc-report-url-input");
    input = inputs[inputs.length - 1];
  }
  input.value = url;
  setReportStatus("已填入当前页签 URL");
}

function getReportInputUrls() {
  const fieldUrls = Array.from(document.querySelectorAll("#gscReportUrlFields .gsc-report-url-input"))
    .map((input) => normalizeUrl(input.value || ""))
    .filter(Boolean);
  return uniqueUrls(fieldUrls);
}

async function restoreJobState() {
  const data = await chrome.storage.local.get([GSC_STORAGE_KEYS.submitJob, GSC_STORAGE_KEYS.reportJob]);
  if (data[GSC_STORAGE_KEYS.submitJob]) {
    const job = data[GSC_STORAGE_KEYS.submitJob];
    setSubmitStatus(formatSubmitStatus(job));
    renderParsedUrls(job.urls || [], job.results || []);
  }
  if (data[GSC_STORAGE_KEYS.reportJob]) {
    const job = data[GSC_STORAGE_KEYS.reportJob];
    if (job.urls?.length) setReportUrlFields(job.urls);
    setReportStatus(formatReportStatus(job));
    renderReportFiles(job.files || []);
  }
}

async function parseAndPreviewUrls() {
  try {
    const urls = await getParsedUrlsFromUi();
    renderParsedUrls(urls, []);
    setSubmitStatus(`已解析 ${urls.length} 个 URL`);
  } catch (e) {
    setSubmitStatus(`解析失败：${e.message || String(e)}`);
  }
}

async function getParsedUrlsFromUi() {
  const input = valueOf("gscUrlInput");
  const domains = parseCsv(valueOf("gscAllowDomains"));
  const urls = await parseUrlsFromInput(input);
  return filterUrlsByDomains(urls, domains);
}

async function parseUrlsFromInput(input) {
  const raw = (input || "").trim();
  if (!raw) return [];

  const maybeUrls = extractUrls(raw);
  const sitemapUrl = maybeUrls.length === 1 && /\.xml(\?|$)/i.test(maybeUrls[0]) ? maybeUrls[0] : "";
  if (sitemapUrl) {
    try {
      return await fetchSitemapRecursive(sitemapUrl, new Set(), 0);
    } catch {
      return uniqueUrls(maybeUrls.map(normalizeUrl).filter(Boolean));
    }
  }

  if (/<urlset|<sitemapindex|<loc[\s>]/i.test(raw)) return parseSitemapXml(raw);
  return uniqueUrls(maybeUrls.map(normalizeUrl).filter(Boolean));
}

async function fetchSitemapRecursive(url, seen, depth) {
  if (seen.has(url) || depth > 4) return [];
  seen.add(url);
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`sitemap http ${res.status}`);
  const xml = await res.text();
  const locs = parseSitemapXml(xml);
  const childSitemaps = locs.filter((x) => /\.xml(\?|$)/i.test(x) && /sitemap/i.test(x));
  if (!childSitemaps.length) return locs;
  const out = [];
  for (const child of childSitemaps) out.push(...(await fetchSitemapRecursive(child, seen, depth + 1)));
  return uniqueUrls(out);
}

function parseSitemapXml(xml) {
  const locs = [];
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  for (const loc of Array.from(doc.querySelectorAll("loc"))) {
    const url = normalizeUrl((loc.textContent || "").trim());
    if (url) locs.push(url);
  }
  if (!locs.length) {
    const re = /<loc[^>]*>\s*([^<]+)\s*<\/loc>/gi;
    let m;
    while ((m = re.exec(xml))) {
      const url = normalizeUrl(decodeHtml(m[1]));
      if (url) locs.push(url);
    }
  }
  return uniqueUrls(locs);
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return matches.map((u) => u.replace(/[.,;]+$/g, ""));
}

function normalizeUrl(url) {
  try {
    const u = new URL(decodeHtml(url.trim()));
    if (!/^https?:$/.test(u.protocol)) return "";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

function isSearchConsoleUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "search.google.com" && /\/search-console(\/|$)/.test(u.pathname);
  } catch {
    return false;
  }
}

function isCoreWebVitalsUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "search.google.com" && u.pathname.includes("/search-console/core-web-vitals");
  } catch {
    return false;
  }
}

function isPageIndexingUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "search.google.com" && u.pathname.includes("/search-console/index");
  } catch {
    return false;
  }
}

function isPerformanceInsightsUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "search.google.com" && u.pathname.includes("/search-console/performance/insights");
  } catch {
    return false;
  }
}

function isGscOverviewUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "search.google.com") return false;
    return /\/search-console\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

function getGscBaseParts(url) {
  const u = new URL(url);
  const accountPrefix = u.pathname.match(/^\/u\/\d+\//)?.[0] || "/";
  const basePath = `${accountPrefix}search-console`;
  const resourceId = u.searchParams.get("resource_id") || DEFAULT_PROPERTY;
  return { origin: u.origin, basePath, resourceId };
}

function buildGscSeedReportUrls(currentUrl) {
  try {
    const { origin, basePath, resourceId } = getGscBaseParts(currentUrl);
    const make = (path, label, priority = 50) => {
      const url = new URL(`${origin}${basePath}${path}`);
      url.searchParams.set("resource_id", resourceId);
      return { url: url.toString(), label, priority };
    };
    return [
      make("", "Overview", 1),
      make("/performance/insights", "Insights", 2),
      make("/performance/search-analytics", "Search results", 3),
      make("/performance/discover", "Discover", 4),
      make("/index", "Pages", 5),
      make("/video-index", "Videos", 6),
      make("/sitemaps", "Sitemaps", 7),
      make("/core-web-vitals", "Core Web Vitals", 8),
      make("/https", "HTTPS", 9),
      make("/r/product", "Product snippets", 10),
      make("/r/merchant-listings", "Merchant listings", 11),
      make("/r/breadcrumbs", "Breadcrumbs", 12),
      make("/r/faq", "FAQ", 13),
      make("/r/review-snippet", "Review snippets", 14),
      make("/amp", "AMP", 15),
      make("/links", "Links", 16),
      make("/removals", "Removals", 17),
      make("/manual-actions", "Manual actions", 18),
      make("/security-issues", "Security issues", 19)
    ];
  } catch {
    return [];
  }
}

function classifyGscReportUrl(url, label = "") {
  try {
    const u = new URL(url);
    if (u.hostname !== "search.google.com" || !/\/search-console(\/|$)/.test(u.pathname)) return null;
    const path = u.pathname;
    const text = `${path} ${label}`.toLowerCase();
    const rules = [
      { type: "overview", priority: 1, test: () => /\/search-console\/?$/.test(path) },
      { type: "performance-insights", priority: 2, test: () => path.includes("/performance/insights") },
      { type: "performance-search-analytics", priority: 3, test: () => path.includes("/performance/search-analytics") },
      { type: "performance-discover", priority: 4, test: () => path.includes("/performance/discover") },
      { type: "page-indexing", priority: 5, test: () => path.includes("/search-console/index") },
      { type: "video-indexing", priority: 6, test: () => path.includes("/video-index") },
      { type: "sitemaps", priority: 7, test: () => path.includes("/sitemaps") },
      { type: "core-web-vitals", priority: 8, test: () => path.includes("/core-web-vitals") },
      { type: "https", priority: 9, test: () => path.includes("/https") },
      { type: "product-snippets", priority: 10, test: () => path.includes("/r/product") },
      { type: "merchant-listings", priority: 11, test: () => path.includes("/r/merchant-listings") },
      { type: "breadcrumbs", priority: 12, test: () => path.includes("/r/breadcrumbs") },
      { type: "faq", priority: 13, test: () => path.includes("/r/faq") },
      { type: "review-snippets", priority: 14, test: () => path.includes("/r/review-snippet") },
      { type: "amp", priority: 15, test: () => path.includes("/amp") },
      { type: "links", priority: 16, test: () => path.includes("/links") },
      { type: "removals", priority: 17, test: () => path.includes("/removals") },
      { type: "manual-actions", priority: 18, test: () => path.includes("/manual-actions") },
      { type: "security-issues", priority: 19, test: () => path.includes("/security-issues") },
      { type: "detail", priority: 25, test: () => /drilldown|issues|details|report|open report|review issues/.test(text) }
    ];
    const match = rules.find((rule) => rule.test());
    if (!match) return null;
    return { ...match, url: u.toString(), label };
  } catch {
    return null;
  }
}

function isImportantGscReportUrl(url, label = "") {
  const classified = classifyGscReportUrl(url, label);
  if (!classified) return false;
  const blocked = /\/settings|\/achievements|\/url-inspection|\/not-verified|privacy|termsofservice|accounts\.google\.com|support\.google\.com/i;
  return !blocked.test(url);
}

function alignGoogleAccountPath(url, currentUrl) {
  try {
    const target = new URL(url);
    const current = new URL(currentUrl);
    if (target.hostname !== "search.google.com" || current.hostname !== "search.google.com") return url;

    const currentAccount = current.pathname.match(/^\/u\/\d+\//)?.[0];
    if (!currentAccount) return url;

    if (/^\/u\/\d+\//.test(target.pathname)) {
      target.pathname = target.pathname.replace(/^\/u\/\d+\//, currentAccount);
      return target.toString();
    }
    if (target.pathname.startsWith("/search-console")) {
      target.pathname = `${currentAccount.replace(/\/$/, "")}${target.pathname}`;
      return target.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function canonicalGscUrlKey(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "search.google.com") return url || "";
    u.hash = "";
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^utm_/i.test(key) || ["hl", "pli", "original_url", "original_resource_id"].includes(key)) u.searchParams.delete(key);
    }
    const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [key, value] of params) u.searchParams.append(key, value);
    return u.toString();
  } catch {
    return url || "";
  }
}

function filterUrlsByDomains(urls, domains) {
  const allow = (domains || []).map((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase());
  if (!allow.length) return uniqueUrls(urls);
  return uniqueUrls(urls).filter((url) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      return allow.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  });
}

function uniqueUrls(urls) {
  return Array.from(new Set((urls || []).filter(Boolean)));
}

async function runSubmitJob() {
  submitController = { stopped: false, paused: false };
  const property = valueOf("gscProperty") || DEFAULT_PROPERTY;
  const urls = await getParsedUrlsFromUi();
  if (!urls.length) return setSubmitStatus("没有可提交的 URL");

  const job = {
    type: "submit",
    property,
    urls,
    results: [],
    current: 0,
    total: urls.length,
    status: "running",
    startedAt: new Date().toISOString()
  };
  await saveSubmitJob(job);
  renderParsedUrls(urls, []);

  const inspectionUrl = `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(property)}`;
  const tab = await chrome.tabs.create({ url: inspectionUrl, active: true });
  await sleep(5500);

  for (let i = 0; i < urls.length; i++) {
    while (submitController.paused && !submitController.stopped) await sleep(500);
    if (submitController.stopped) break;

    job.current = i + 1;
    setSubmitStatus(`提交中 ${i + 1}/${urls.length}: ${urls[i]}`);
    const result = await submitSingleUrl(tab.id, urls[i]);
    job.results.push(result);
    await saveSubmitJob(job);
    renderParsedUrls(urls, job.results);
    await sleep(3000);
  }

  job.status = submitController.stopped ? "stopped" : "done";
  job.finishedAt = new Date().toISOString();
  await saveSubmitJob(job);
  setSubmitStatus(formatSubmitStatus(job));
}

async function submitSingleUrl(tabId, url) {
  const startedAt = new Date().toISOString();
  try {
    await chrome.tabs.update(tabId, { active: true });
    const typed = await runInTab(tabId, pageTypeUrlForInspection, [url]);
    if (!typed?.ok) throw new Error(typed?.error || "URL input not found");

    await sleep(20000);
    const clicked = await runInTab(tabId, pageClickButtonByText, [REQUEST_INDEXING_TEXTS]);
    if (!clicked?.ok) {
      const text = await runInTab(tabId, pageTextSnapshot, []);
      const lower = (text?.text || "").toLowerCase();
      if (/already|quota|配额|已请求|无法请求/i.test(lower)) {
        return { url, status: "skipped", message: "Request button unavailable; likely already requested or quota-limited", startedAt, finishedAt: new Date().toISOString() };
      }
      throw new Error(clicked?.error || "Request indexing button not found");
    }

    await sleep(40000);
    await runInTab(tabId, pageClickButtonByText, [CLOSE_TEXTS]);
    return { url, status: "success", message: "Requested indexing", startedAt, finishedAt: new Date().toISOString() };
  } catch (e) {
    let screenshot = "";
    try { screenshot = await chrome.tabs.captureVisibleTab(undefined, { format: "png" }); } catch {}
    return { url, status: "failed", message: e.message || String(e), screenshot, startedAt, finishedAt: new Date().toISOString() };
  }
}

async function runReportCaptureJob() {
  reportController = { stopped: false };
  const activeTab = await getActiveTab();
  const currentUrl = normalizeUrl(activeTab?.url || "");
  const inputUrls = getReportInputUrls();
  const urls = inputUrls.length ? inputUrls.map((url) => alignGoogleAccountPath(url, currentUrl)) : [currentUrl].filter(Boolean);
  const cwvDrilldown = !!document.getElementById("gscCwvDrilldown")?.checked;
  const indexingDrilldown = !!document.getElementById("gscIndexingDrilldown")?.checked;
  const performanceDrilldown = !!document.getElementById("gscPerformanceDrilldown")?.checked;
  const aiReportSummary = !!document.getElementById("gscAiReportSummary")?.checked;
  const recursiveDiscovery = !!document.getElementById("gscRecursiveDiscovery")?.checked;
  const includeDetails = !!document.getElementById("gscIncludeDetails")?.checked;
  const maxDepth = clampInt(valueOf("gscMaxDepth"), 0, 3, 2);
  const maxPages = clampInt(valueOf("gscMaxPages"), 1, 60, 30);
  if (!activeTab?.id) return setReportStatus("没有可用的当前页签");
  if (!urls.length) return setReportStatus("请先在当前页签打开 GSC 报告页，或粘贴要在当前页签中抓取的报告 URL");
  if (!inputUrls.length && !isSearchConsoleUrl(currentUrl)) return setReportStatus("当前页签不是 GSC 报告页，请先打开正确的 Search Console 页面");

  const seedSourceUrl = [currentUrl, ...urls].find((candidate) => isGscOverviewUrl(candidate));
  const seedReports = recursiveDiscovery && seedSourceUrl ? buildGscSeedReportUrls(seedSourceUrl) : [];
  const queueUrls = uniqueStrings([...urls, ...seedReports.map((seed) => alignGoogleAccountPath(seed.url, currentUrl))]).slice(0, maxPages);

  const folder = buildGscReportFolderName(new Date());
  const job = { type: "reports", urls, seedReports, recursiveDiscovery, files: [], pages: [], status: "running", startedAt: new Date().toISOString(), folder, downloadFolder: `Downloads/${folder}`, tabId: activeTab.id };
  await saveReportJob(job);

  const queue = queueUrls.map((url) => ({ url, depth: 0, source: seedReports.some((seed) => canonicalGscUrlKey(alignGoogleAccountPath(seed.url, currentUrl)) === canonicalGscUrlKey(url)) ? "seed" : "entry" }));
  const seen = new Set();
  while (queue.length && job.pages.length < maxPages && !reportController.stopped) {
    const item = queue.shift();
    const itemKey = canonicalGscUrlKey(item?.url || "");
    if (!item?.url || seen.has(itemKey)) continue;
    seen.add(itemKey);
    setReportStatus(`抓取 ${job.pages.length + 1}/${maxPages}: ${item.url}`);

    const page = await captureSingleReportPage(activeTab.id, item.url, folder, job.pages.length + 1, item.depth, { cwvDrilldown, indexingDrilldown, performanceDrilldown, recursiveDiscovery, maxPages });
    job.pages.push(page);
    job.files.push(...(page.files || []));
    renderReportFiles(job.files);
    await saveReportJob(job);

    const candidateUrls = uniqueStrings([
      ...(includeDetails ? (page.detailUrls || []) : []),
      ...(recursiveDiscovery ? (page.discoveredReports || []).map((report) => report.url) : [])
    ]);
    if (candidateUrls.length && item.depth < maxDepth) {
      for (const detailUrl of candidateUrls) {
        const alignedDetailUrl = alignGoogleAccountPath(detailUrl, currentUrl);
        const detailKey = canonicalGscUrlKey(alignedDetailUrl);
        if (!isImportantGscReportUrl(alignedDetailUrl)) continue;
        if (!seen.has(detailKey) && !queue.some((queued) => canonicalGscUrlKey(queued.url) === detailKey) && queue.length + job.pages.length < maxPages) {
          queue.push({ url: alignedDetailUrl, depth: item.depth + 1, source: item.url });
        }
      }
    }
  }

  const indexPath = `${folder}/gsc-report-index.md`;
  const manifestPath = `${folder}/gsc-report-manifest.json`;
  job.status = reportController.stopped ? "stopped" : "done";
  job.finishedAt = new Date().toISOString();
  job.truncated = queue.length > 0 && job.pages.length >= maxPages;
  job.remainingQueue = queue.slice(0, 20).map((item) => ({ url: item.url, depth: item.depth, source: item.source }));
  job.files = uniqueStrings([...job.files, indexPath, manifestPath]);

  if (aiReportSummary && !reportController.stopped) {
    const ai = await buildAiGscReportSummary(job);
    if (ai?.ok) job.aiSummary = ai.ai;
    else if (ai?.error && !/AI 未启用|ai server/i.test(ai.error)) job.aiSummaryError = ai.error;
  }

  const indexMd = buildIndexMarkdown(job);
  const manifest = JSON.stringify(job, null, 2);
  await downloadTextFile(indexPath, indexMd, "text/markdown;charset=utf-8");
  await downloadTextFile(manifestPath, manifest, "application/json;charset=utf-8");
  await saveReportJob(job);
  setReportStatus(formatReportStatus(job));
  renderReportFiles(job.files);
}

async function captureSingleReportPage(tabId, url, folder, index, depth, options = {}) {
  const titleFallback = `report-${index}`;
  try {
    const tab = await navigateReportTab(tabId, url);
    const actualStartUrl = normalizeUrl(tab?.url || url);
    if (options.cwvDrilldown && isCoreWebVitalsUrl(actualStartUrl)) {
      return await captureCoreWebVitalsDrilldown(tabId, actualStartUrl, folder, index, depth, options);
    }
    if (options.indexingDrilldown && isPageIndexingUrl(actualStartUrl)) {
      return await capturePageIndexingDrilldown(tabId, actualStartUrl, folder, index, depth, options);
    }
    if (options.performanceDrilldown && isPerformanceInsightsUrl(actualStartUrl)) {
      return await capturePerformanceInsightsDrilldown(tabId, actualStartUrl, folder, index, depth, options);
    }
    await runInTab(tabId, pageAutoScroll, []);
    await sleep(1200);

    const extracted = await runInTab(tabId, pageExtractReportMetrics, [DETAIL_TEXTS]);
    const title = extracted?.title || titleFallback;
    const actualUrl = extracted?.url || tab?.url || url;
    const slug = numberedReportSlug(index, reportTypeFromUrl(actualUrl), title || actualUrl);
    const mdPath = `${folder}/${slug}.md`;
    const pngPath = `${folder}/${slug}-full-page.png`;
    const jsonPath = `${folder}/${slug}.json`;
    const screenshotDataUrl = await captureReportScreenshot(tabId);
    const md = buildPageMarkdown({ url: actualUrl, title, depth, extracted, screenshot: pngPath });
    await downloadTextFile(mdPath, md, "text/markdown;charset=utf-8");
    await downloadTextFile(jsonPath, JSON.stringify({ url: actualUrl, requestedUrl: url, title, depth, extracted }, null, 2), "application/json;charset=utf-8");
    await downloadDataUrlFile(pngPath, screenshotDataUrl);
    return {
      url: actualUrl,
      requestedUrl: url,
      title,
      status: "success",
      depth,
      files: [mdPath, jsonPath, pngPath],
      screenshot: pngPath,
      metrics: extracted?.metrics || [],
      tables: extracted?.tables || [],
      discoveredReports: extracted?.discoveredReports || [],
      detailUrls: uniqueStrings([...(extracted?.detailUrls || []), ...((extracted?.discoveredReports || []).map((report) => report.url))])
    };
  } catch (e) {
    const title = titleFallback;
    const slug = numberedReportSlug(index, reportTypeFromUrl(url), title, "failed");
    const mdPath = `${folder}/${slug}.md`;
    const pngPath = `${folder}/${slug}-error.png`;
    const files = [mdPath];
    let screenshot = "";
    try {
      await downloadDataUrlFile(pngPath, await captureReportScreenshot(tabId));
      files.push(pngPath);
      screenshot = pngPath;
    } catch {}
    const currentTab = await chrome.tabs.get(tabId).catch(() => null);
    const currentTabUrl = currentTab?.url ? `\nCurrent tab URL: ${currentTab.url}\n` : "";
    const md = `# ${title}\n\nURL: ${url}${currentTabUrl}\nStatus: failed\n\nError: ${e.message || String(e)}\n`;
    await downloadTextFile(mdPath, md, "text/markdown;charset=utf-8");
    return { url, requestedUrl: url, title, status: "failed", depth, error: e.message || String(e), files, screenshot, metrics: [], detailUrls: [] };
  }
}

async function captureCoreWebVitalsDrilldown(tabId, startUrl, folder, index, depth, options = {}) {
  const title = "Core Web Vitals Drilldown";
  const slugBase = numberedReportSlug(index, "core-web-vitals", "drilldown");
  const files = [];
  const result = {
    title,
    url: startUrl,
    depth,
    devices: [],
    startedAt: new Date().toISOString()
  };
  let remainingIssueDrilldowns = clampInt(options.maxPages, 1, 60, 30);

  await waitForPageCondition(tabId, pageHasCwvContent, [], 20000);
  const startState = await runInTab(tabId, pageGetCwvStartState, []);
  const isSummary = !!startState?.isSummary;
  const deviceNames = isSummary
    ? (startState.devices?.length ? startState.devices : ["Mobile", "Desktop"])
    : [startState?.currentDevice || "Current"];

  for (const deviceName of deviceNames) {
    if (reportController.stopped || remainingIssueDrilldowns <= 0) break;
    const device = { name: deviceName, issues: [], errors: [] };
    result.devices.push(device);

    if (isSummary) {
      await navigateReportTab(tabId, startUrl);
      await waitForPageCondition(tabId, pageHasCwvContent, [], 20000);
      setReportStatus(`CWV ${deviceName}: 打开报告`);
      const opened = await runInTab(tabId, pageClickCwvDeviceReport, [deviceName]);
      if (!opened?.ok) {
        device.errors.push(opened?.error || `Open report not found for ${deviceName}`);
        continue;
      }
      const issueReady = await waitForPageCondition(tabId, pageHasCwvIssueTable, [], 25000);
      if (!issueReady?.ok) {
        device.errors.push(issueReady?.error || `Issue table did not load for ${deviceName}`);
        continue;
      }
      await sleep(1500);
    } else {
      const issueReady = await waitForPageCondition(tabId, pageHasCwvIssueTable, [], 25000);
      if (!issueReady?.ok) device.errors.push(issueReady?.error || "Issue table did not load");
    }

    const issueTab = await chrome.tabs.get(tabId);
    device.issueReportUrl = normalizeUrl(issueTab?.url || "");
    const issueRows = await runInTab(tabId, pageExtractCwvIssueRows, []);
    device.issues = issueRows?.rows || [];
    if (!device.issues.length) {
      device.errors.push(issueRows?.error || "No Core Web Vitals issue rows found");
      continue;
    }

    await runInTab(tabId, pageScrollToCwvIssueTable, []);
    const issueScreenshotPath = `${folder}/${slugBase}-${safeSlug(deviceName)}-issues.png`;
    await downloadDataUrlFile(issueScreenshotPath, await captureReportScreenshot(tabId));
    files.push(issueScreenshotPath);
    device.issueScreenshot = issueScreenshotPath;

    for (let i = 0; i < device.issues.length && remainingIssueDrilldowns > 0; i++) {
      if (reportController.stopped) break;
      const issue = device.issues[i];
      setReportStatus(`CWV ${deviceName}: 下钻 ${i + 1}/${device.issues.length} ${issue.issue}`);
      await navigateReportTab(tabId, device.issueReportUrl);
      const issueReady = await waitForPageCondition(tabId, pageHasCwvIssueTable, [], 20000);
      if (!issueReady?.ok) {
        issue.error = issueReady?.error || "Issue table did not reload";
        continue;
      }

      const clicked = await runInTab(tabId, pageClickCwvIssueRow, [issue.issue, issue.rowIndex]);
      if (!clicked?.ok) {
        issue.error = clicked?.error || "Issue row click failed";
        continue;
      }

      const ready = await waitForPageCondition(tabId, pageHasCwvUrlGroupsTable, [], 25000);
      if (!ready?.ok && ready !== true) {
        issue.error = ready?.error || "URL groups table did not load";
        continue;
      }

      await runInTab(tabId, pageScrollToCwvUrlGroupsTable, []);
      await sleep(700);
      const groups = await runInTab(tabId, pageExtractCwvUrlGroups, [issue]);
      issue.detailUrl = groups?.url || normalizeUrl((await chrome.tabs.get(tabId))?.url || "");
      issue.urlGroups = groups?.rows || [];
      issue.urlGroupHeaders = groups?.headers || [];
      issue.detailTitle = groups?.title || "URL groups";
      issue.metricColumn = groups?.metricColumn || "";
      issue.pagination = groups?.pagination || "";

      for (let pageNo = 2; pageNo <= 10; pageNo++) {
        const next = await runInTab(tabId, pageClickCwvUrlGroupsNextPage, []);
        if (!next?.ok) break;
        await sleep(1200);
        const nextGroups = await runInTab(tabId, pageExtractCwvUrlGroups, [issue]);
        const byUrl = new Map((issue.urlGroups || []).map((row) => [row.exampleUrl || JSON.stringify(row.values), row]));
        for (const row of nextGroups?.rows || []) byUrl.set(row.exampleUrl || JSON.stringify(row.values), row);
        issue.urlGroups = Array.from(byUrl.values());
        issue.pagination = nextGroups?.pagination || issue.pagination;
      }

      const detailScreenshotPath = `${folder}/${slugBase}-${safeSlug(deviceName)}-${String(i + 1).padStart(2, "0")}-${safeSlug(issue.issue)}.png`;
      await downloadDataUrlFile(detailScreenshotPath, await captureReportScreenshot(tabId));
      files.push(detailScreenshotPath);
      issue.detailScreenshot = detailScreenshotPath;
      remainingIssueDrilldowns -= 1;
    }
  }

  result.finishedAt = new Date().toISOString();
  const mdPath = `${folder}/${slugBase}.md`;
  const jsonPath = `${folder}/${slugBase}.json`;
  await downloadTextFile(mdPath, buildCoreWebVitalsMarkdown(result), "text/markdown;charset=utf-8");
  await downloadTextFile(jsonPath, JSON.stringify(result, null, 2), "application/json;charset=utf-8");
  files.push(mdPath, jsonPath);

  const metrics = result.devices.flatMap((device) => (device.issues || []).map((issue) => {
    const groupCount = issue.urlGroups?.length ? `, URL groups ${issue.urlGroups.length}` : "";
    return `${device.name}: ${issue.severity || ""} ${issue.issue || ""} (${issue.urls || "0"} URLs${groupCount})`.replace(/\s+/g, " ").trim();
  })).slice(0, 80);

  return {
    url: startUrl,
    title,
    status: "success",
    depth,
    files,
    screenshot: files.find((file) => file.endsWith(".png")) || "",
    metrics,
    detailUrls: [],
    cwv: result
  };
}

async function capturePageIndexingDrilldown(tabId, startUrl, folder, index, depth, options = {}) {
  const title = "Page Indexing Drilldown";
  const slugBase = numberedReportSlug(index, "page-indexing", "drilldown");
  const files = [];
  const result = {
    title,
    url: startUrl,
    depth,
    reasons: [],
    errors: [],
    startedAt: new Date().toISOString()
  };
  let remainingReasonDrilldowns = clampInt(options.maxPages, 1, 60, 30);

  await waitForPageCondition(tabId, pageHasIndexingContent, [], 20000);
  const startState = await runInTab(tabId, pageGetIndexingStartState, []);

  if (startState?.isDrilldown) {
    await waitForPageCondition(tabId, pageHasIndexingExamplesTable, [], 25000);
    await runInTab(tabId, pageScrollToIndexingExamplesTable, []);
    const examples = await runInTab(tabId, pageExtractIndexingExamples, [{}]);
    const reason = {
      rowIndex: 0,
      reason: examples?.reason || "Current drilldown",
      detailUrl: examples?.url || startUrl,
      examples: examples?.rows || [],
      exampleHeaders: examples?.headers || [],
      pagination: examples?.pagination || ""
    };
    const screenshotPath = `${folder}/${slugBase}-current-examples.png`;
    await downloadDataUrlFile(screenshotPath, await captureReportScreenshot(tabId));
    files.push(screenshotPath);
    reason.detailScreenshot = screenshotPath;
    await collectIndexingExamplesPages(tabId, reason);
    result.reasons.push(reason);
  } else {
    const ready = await waitForPageCondition(tabId, pageHasIndexingReasonTable, [], 25000);
    if (!ready?.ok) result.errors.push(ready?.error || "Page Indexing reason table did not load");

    const reportTab = await chrome.tabs.get(tabId);
    result.reasonReportUrl = normalizeUrl(reportTab?.url || startUrl);
    if (ready?.ok) {
      await runInTab(tabId, pageScrollToIndexingReasonTable, []);
      const reasonScreenshotPath = `${folder}/${slugBase}-reasons.png`;
      await downloadDataUrlFile(reasonScreenshotPath, await captureReportScreenshot(tabId));
      files.push(reasonScreenshotPath);
      result.reasonScreenshot = reasonScreenshotPath;
    }
    const reasonRows = await collectIndexingReasonRows(tabId);
    result.reasons = reasonRows?.rows || [];
    if (!result.reasons.length) result.errors.push(reasonRows?.error || "No Page Indexing reasons found");

    for (let i = 0; i < result.reasons.length && remainingReasonDrilldowns > 0; i++) {
      if (reportController.stopped) break;
      const reason = result.reasons[i];
      setReportStatus(`Indexing: 下钻 ${i + 1}/${result.reasons.length} ${reason.reason}`);
      await navigateReportTab(tabId, result.reasonReportUrl || startUrl);
      const reasonReady = await waitForPageCondition(tabId, pageHasIndexingReasonTable, [], 20000);
      if (!reasonReady?.ok) {
        reason.error = reasonReady?.error || "Reason table did not reload";
        continue;
      }
      await navigateIndexingReasonTablePage(tabId, reason.pageNumber || 1);

      const clicked = await runInTab(tabId, pageClickIndexingReasonRow, [reason.reason, reason.rowIndex]);
      if (!clicked?.ok) {
        reason.error = clicked?.error || "Reason row click failed";
        continue;
      }

      const examplesReady = await waitForPageCondition(tabId, pageHasIndexingExamplesTable, [], 25000);
      if (!examplesReady?.ok) {
        reason.error = examplesReady?.error || "Examples table did not load";
        continue;
      }

      await runInTab(tabId, pageScrollToIndexingExamplesTable, []);
      await sleep(700);
      const examples = await runInTab(tabId, pageExtractIndexingExamples, [reason]);
      reason.detailUrl = examples?.url || normalizeUrl((await chrome.tabs.get(tabId))?.url || "");
      reason.detailTitle = examples?.title || "Examples";
      reason.examples = examples?.rows || [];
      reason.exampleHeaders = examples?.headers || [];
      reason.pagination = examples?.pagination || "";

      const detailScreenshotPath = `${folder}/${slugBase}-${String(i + 1).padStart(2, "0")}-${safeSlug(reason.reason)}-examples.png`;
      await downloadDataUrlFile(detailScreenshotPath, await captureReportScreenshot(tabId));
      files.push(detailScreenshotPath);
      reason.detailScreenshot = detailScreenshotPath;
      await collectIndexingExamplesPages(tabId, reason);
      remainingReasonDrilldowns -= 1;
    }
  }

  result.finishedAt = new Date().toISOString();
  const mdPath = `${folder}/${slugBase}.md`;
  const jsonPath = `${folder}/${slugBase}.json`;
  await downloadTextFile(mdPath, buildPageIndexingMarkdown(result), "text/markdown;charset=utf-8");
  await downloadTextFile(jsonPath, JSON.stringify(result, null, 2), "application/json;charset=utf-8");
  files.push(mdPath, jsonPath);

  const metrics = (result.reasons || []).map((reason) => {
    const exampleCount = reason.examples?.length ? `, examples ${reason.examples.length}` : "";
    return `${reason.reason || ""} (${reason.pages || "0"} pages${exampleCount})`.replace(/\s+/g, " ").trim();
  }).slice(0, 80);

  return {
    url: startUrl,
    title,
    status: "success",
    depth,
    files,
    screenshot: files.find((file) => file.endsWith(".png")) || "",
    metrics,
    detailUrls: [],
    indexing: result
  };
}

async function collectIndexingExamplesPages(tabId, reason) {
  for (let pageNo = 2; pageNo <= 10; pageNo++) {
    const next = await runInTab(tabId, pageClickIndexingExamplesNextPage, []);
    if (!next?.ok) break;
    await sleep(1200);
    const nextExamples = await runInTab(tabId, pageExtractIndexingExamples, [reason]);
    const byUrl = new Map((reason.examples || []).map((row) => [row.url || JSON.stringify(row.values), row]));
    for (const row of nextExamples?.rows || []) byUrl.set(row.url || JSON.stringify(row.values), row);
    reason.examples = Array.from(byUrl.values());
    reason.pagination = nextExamples?.pagination || reason.pagination;
  }
}

async function collectIndexingReasonRows(tabId) {
  const rows = [];
  const byReason = new Map();
  let pageNumber = 1;
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const extracted = await runInTab(tabId, pageExtractIndexingReasonRows, [pageNumber]);
    for (const row of extracted?.rows || []) {
      const key = `${row.reason}|${row.source}|${row.pages}`;
      if (!byReason.has(key)) {
        byReason.set(key, row);
        rows.push(row);
      }
    }
    const next = await runInTab(tabId, pageClickIndexingReasonNextPage, []);
    if (!next?.ok) break;
    pageNumber += 1;
    await sleep(1000);
  }
  return { ok: rows.length > 0, rows, error: rows.length ? "" : "No Page Indexing reasons found" };
}

async function navigateIndexingReasonTablePage(tabId, pageNumber) {
  for (let pageNo = 1; pageNo < pageNumber; pageNo++) {
    const next = await runInTab(tabId, pageClickIndexingReasonNextPage, []);
    if (!next?.ok) return next;
    await sleep(900);
  }
  return { ok: true };
}

async function capturePerformanceInsightsDrilldown(tabId, startUrl, folder, index, depth) {
  const title = "Performance Insights Drilldown";
  const slugBase = numberedReportSlug(index, "performance-insights", "drilldown");
  const files = [];
  const config = buildPerformanceInsightsTargets(startUrl);
  const result = {
    title,
    url: startUrl,
    depth,
    targets: [],
    errors: [],
    startedAt: new Date().toISOString()
  };

  for (const target of config.targets) {
    if (reportController.stopped) break;
    setReportStatus(`Insights: 抓取 ${target.label}`);
    await navigateReportTab(tabId, target.contentUrl);
    const ready = await waitForPageCondition(tabId, pageHasPerformanceInsightsContent, [], 25000);
    const targetResult = {
      label: target.label,
      timeRange: target.timeRange,
      contentTab: target.contentTab,
      contentUrl: target.contentUrl,
      searchAnalyticsUrl: target.searchAnalyticsUrl,
      rows: [],
      searchAnalyticsRows: [],
      errors: []
    };
    result.targets.push(targetResult);
    if (!ready?.ok) {
      targetResult.errors.push(ready?.error || "Performance Insights content did not load");
      continue;
    }

    await runInTab(tabId, pageScrollToPerformanceInsightsContent, []);
    await sleep(700);
    const extracted = await runInTab(tabId, pageExtractPerformanceInsightsContent, [target]);
    targetResult.rows = extracted?.rows || [];
    targetResult.pageTitle = extracted?.title || "";
    targetResult.activeTab = extracted?.activeTab || "";
    targetResult.pagination = extracted?.pagination || "";

    const screenshotPath = `${folder}/${slugBase}-${safeSlug(target.label)}.png`;
    await downloadDataUrlFile(screenshotPath, await captureReportScreenshot(tabId));
    files.push(screenshotPath);
    targetResult.screenshot = screenshotPath;

    if (target.includeSearchAnalytics && target.searchAnalyticsUrl) {
      setReportStatus(`Insights: 抓取 Search Analytics ${target.label}`);
      await navigateReportTab(tabId, target.searchAnalyticsUrl);
      const tableReady = await waitForPageCondition(tabId, pageHasPerformanceSearchAnalyticsTable, [], 30000);
      if (!tableReady?.ok) {
        targetResult.errors.push(tableReady?.error || "Search Analytics table did not load");
      } else {
        await runInTab(tabId, pageScrollToPerformanceSearchAnalyticsTable, []);
        await sleep(900);
        const analytics = await runInTab(tabId, pageExtractPerformanceSearchAnalyticsRows, []);
        targetResult.searchAnalyticsRows = analytics?.rows || [];
        targetResult.searchAnalyticsHeaders = analytics?.headers || [];
        targetResult.searchAnalyticsPagination = analytics?.pagination || "";
        const analyticsScreenshotPath = `${folder}/${slugBase}-${safeSlug(target.label)}-search-analytics.png`;
        await downloadDataUrlFile(analyticsScreenshotPath, await captureReportScreenshot(tabId));
        files.push(analyticsScreenshotPath);
        targetResult.searchAnalyticsScreenshot = analyticsScreenshotPath;
      }
    }
  }

  result.finishedAt = new Date().toISOString();
  const mdPath = `${folder}/${slugBase}.md`;
  const jsonPath = `${folder}/${slugBase}.json`;
  await downloadTextFile(mdPath, buildPerformanceInsightsMarkdown(result), "text/markdown;charset=utf-8");
  await downloadTextFile(jsonPath, JSON.stringify(result, null, 2), "application/json;charset=utf-8");
  files.push(mdPath, jsonPath);

  const metrics = result.targets.flatMap((target) => (target.rows || []).map((row) => {
    const change = [row.direction, row.changePercent, row.clickDelta || row.clicks].filter(Boolean).join(" ");
    return `${target.label}: ${row.title || row.url} ${change}`.trim();
  })).slice(0, 80);

  return {
    url: startUrl,
    title,
    status: "success",
    depth,
    files,
    screenshot: files.find((file) => file.endsWith(".png")) || "",
    metrics,
    detailUrls: [],
    performanceInsights: result
  };
}

function buildPerformanceInsightsTargets(startUrl) {
  const start = new URL(startUrl);
  const accountPrefix = start.pathname.match(/^\/u\/\d+\//)?.[0] || "/";
  const basePath = `${accountPrefix}search-console`;
  const resourceId = start.searchParams.get("resource_id") || DEFAULT_PROPERTY;
  const origin = `${start.origin}${basePath}`;
  const makeContentUrl = (timeRange, contentTab) => {
    const url = new URL(`${origin}/performance/insights/content`);
    url.searchParams.set("resource_id", resourceId);
    url.searchParams.set("time_range", timeRange);
    url.searchParams.set("content_tab", contentTab);
    return url.toString();
  };
  const makeSearchAnalyticsUrl = (timeRange, contentTab) => {
    const contentUrl = makeContentUrl(timeRange, contentTab);
    const url = new URL(`${origin}/performance/search-analytics`);
    url.searchParams.set("resource_id", resourceId);
    url.searchParams.set("breakdown", "page");
    url.searchParams.set("insights_back_url", contentUrl);
    url.searchParams.set("source_view", "insights");
    url.searchParams.set("num_of_days", timeRange === "LAST7DAYS" ? "7" : "28");
    url.searchParams.set("compare_date", "PREV");
    url.hash = "dimension-tables";
    return url.toString();
  };
  const targets = [
    { label: "Last 28 days - Top", timeRange: "LAST28DAYS", contentTab: "TOP" },
    { label: "Last 28 days - Trending up", timeRange: "LAST28DAYS", contentTab: "TRENDING_UP" },
    { label: "Last 28 days - Trending down", timeRange: "LAST28DAYS", contentTab: "TRENDING_DOWN" },
    { label: "Last 7 days - Trending down", timeRange: "LAST7DAYS", contentTab: "TRENDING_DOWN", includeSearchAnalytics: true }
  ].map((target) => ({
    ...target,
    contentUrl: makeContentUrl(target.timeRange, target.contentTab),
    searchAnalyticsUrl: makeSearchAnalyticsUrl(target.timeRange, target.contentTab)
  }));
  return { resourceId, targets };
}

async function waitForPageCondition(tabId, func, args = [], timeoutMs = 20000, intervalMs = 700) {
  const started = Date.now();
  let lastResult;
  while (Date.now() - started < timeoutMs && !reportController.stopped) {
    try {
      lastResult = await runInTab(tabId, func, args);
      if (lastResult === true || lastResult?.ok) return lastResult;
    } catch (e) {
      lastResult = { ok: false, error: e.message || String(e) };
    }
    await sleep(intervalMs);
  }
  return lastResult || { ok: false, error: "Timed out waiting for page condition" };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function navigateReportTab(tabId, url) {
  let tab = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  if (url && normalizeUrl(tab?.url || "") !== url) {
    const loaded = waitForTabComplete(tabId, 25000, false);
    tab = await chrome.tabs.update(tabId, { url, active: true });
    await loaded;
    await sleep(2500);
  } else {
    if (tab?.status !== "complete") await waitForTabComplete(tabId, 10000);
    await sleep(1000);
  }
  return chrome.tabs.get(tabId).catch(() => tab);
}

function waitForTabComplete(tabId, timeoutMs, checkCurrent = true) {
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") finish();
    };
    timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    if (!checkCurrent) return;
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete") finish();
    }).catch(finish);
  });
}

async function captureVisibleTabForTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
}

async function captureReportScreenshot(tabId) {
  try {
    return await captureFullPageScreenshotWithDebugger(tabId);
  } catch (e) {
    console.warn("Falling back to visible tab screenshot", e);
    return captureVisibleTabForTab(tabId);
  }
}

async function captureFullPageScreenshotWithDebugger(tabId) {
  const target = { tabId };
  const metrics = await runInTab(tabId, pageGetScreenshotCaptureMetrics, []);
  const width = clampInt(metrics?.width, 1280, 2400, 1600);
  const viewportHeight = clampInt(metrics?.viewportHeight, 800, 1400, 1000);
  const maxHeight = 16000;
  let attached = false;
  try {
    await debuggerAttach(target);
    attached = true;
    await debuggerSend(target, "Page.enable");
    await debuggerSend(target, "Emulation.setDeviceMetricsOverride", {
      width,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: viewportHeight
    });
    await sleep(650);

    const layout = await debuggerSend(target, "Page.getLayoutMetrics");
    const content = layout?.cssContentSize || layout?.contentSize || {};
    const clipWidth = Math.ceil(Math.min(Math.max(width, content.width || width), 2400));
    const clipHeight = Math.ceil(Math.min(Math.max(viewportHeight, content.height || metrics?.height || viewportHeight), maxHeight));
    const screenshot = await debuggerSend(target, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: clipWidth, height: clipHeight, scale: 1 }
    });
    if (!screenshot?.data) throw new Error("Debugger screenshot returned empty data");
    return `data:image/png;base64,${screenshot.data}`;
  } finally {
    if (attached) {
      await debuggerSend(target, "Emulation.clearDeviceMetricsOverride").catch(() => {});
      await debuggerDetach(target).catch(() => {});
      await sleep(250);
    }
  }
}

function debuggerAttach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function debuggerDetach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(target, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function debuggerSend(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

function pageTypeUrlForInspection(url) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="combobox"], [role="textbox"]'));
  const input = candidates.find(visible);
  if (!input) return { ok: false, error: "No visible URL inspection input" };
  input.focus();
  if ("value" in input) {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = url;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    input.textContent = url;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: url }));
  }
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  return { ok: true };
}

function pageClickButtonByText(texts) {
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = (texts || []).map(norm);
  const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, div[tabindex], span[tabindex]'));
  const el = nodes.find((node) => visible(node) && wanted.some((t) => norm(node.innerText || node.textContent || node.getAttribute("aria-label")).includes(t)));
  if (!el) return { ok: false, error: `Button not found: ${texts.join(" / ")}` };
  el.scrollIntoView({ block: "center", inline: "center" });
  el.click();
  return { ok: true, text: el.innerText || el.textContent || el.getAttribute("aria-label") || "" };
}

function pageTextSnapshot() {
  return { text: (document.body?.innerText || "").slice(0, 5000) };
}

function pageGetScreenshotCaptureMetrics() {
  const doc = document.documentElement;
  const body = document.body;
  const scrollWidth = Math.max(
    doc?.scrollWidth || 0,
    body?.scrollWidth || 0,
    doc?.clientWidth || 0,
    window.innerWidth || 0
  );
  const scrollHeight = Math.max(
    doc?.scrollHeight || 0,
    body?.scrollHeight || 0,
    doc?.clientHeight || 0,
    window.innerHeight || 0
  );
  return {
    width: Math.ceil(Math.max(1440, scrollWidth)),
    height: Math.ceil(scrollHeight),
    viewportHeight: Math.ceil(Math.max(900, window.innerHeight || 0)),
    devicePixelRatio: window.devicePixelRatio || 1,
    url: location.href,
    title: document.title || ""
  };
}

async function pageAutoScroll() {
  await new Promise((resolve) => {
    let total = 0;
    const timer = setInterval(() => {
      window.scrollBy(0, Math.max(420, window.innerHeight * 0.75));
      total += 1;
      if (total > 8 || window.scrollY + window.innerHeight >= document.body.scrollHeight - 10) {
        clearInterval(timer);
        window.scrollTo(0, 0);
        resolve();
      }
    }, 350);
  });
  return { ok: true };
}

function pageExtractReportMetrics(detailTexts) {
  const text = document.body?.innerText || "";
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const pageHeading = clean(document.querySelector('[role="heading"][aria-level="1"], h1')?.innerText || document.querySelector('[role="heading"], h1')?.innerText || "");
  const title = pageHeading || clean(document.title) || location.pathname;
  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .map((x) => clean(x.innerText || x.textContent))
    .filter(Boolean)
    .slice(0, 30);

  const metricNodes = Array.from(document.querySelectorAll('[role="heading"], h1, h2, h3, h4, [aria-label], div, span'))
    .map((el) => clean(el.innerText || el.getAttribute("aria-label") || ""))
    .filter((x) => x && x.length <= 160 && /\d|good|poor|needs improvement|indexed|not indexed|valid|invalid|错误|有效|已编入|未编入|较差|良好|需要改进/i.test(x));
  const metrics = Array.from(new Set(metricNodes)).slice(0, 80);

  const compactUrlCell = (value) => {
    const raw = clean(value);
    if (!/https?:\/\//i.test(raw)) return raw;
    const compact = raw.replace(/\s+/g, "");
    const match = compact.match(/https?:\/\/.+/i);
    return match ? match[0] : compact;
  };
  const extractTable = (table, index) => {
    const headerCells = table.querySelectorAll("thead th, thead td").length
      ? Array.from(table.querySelectorAll("thead th, thead td"))
      : Array.from(table.querySelectorAll("tr:first-child th, tr:first-child td"));
    const headers = headerCells
      .map((th) => clean(th.getAttribute("data-name") || th.getAttribute("data-label") || th.innerText || th.textContent))
      .filter(Boolean)
      .slice(0, 12);
    const rows = Array.from(table.querySelectorAll("tbody tr"))
      .map((row) => Array.from(row.querySelectorAll("th, td"))
        .map((cell) => compactUrlCell(cell.getAttribute("data-string-value") || cell.getAttribute("data-numeric-value") || cell.innerText || cell.textContent))
        .filter((cell) => cell !== ""))
      .filter((row) => row.length && row.some(Boolean))
      .slice(0, 120);
    const before = table.closest(".VfPpkd-WsjYwc, .card, section, c-wiz, div") || table.parentElement;
    const caption = clean(before?.querySelector?.("h1,h2,h3,[role='heading']")?.innerText || before?.querySelector?.(".cPSNDf,.ZxwVRb")?.innerText || `Table ${index + 1}`);
    return { caption, headers, rows };
  };
  const tables = Array.from(document.querySelectorAll("table"))
    .map(extractTable)
    .filter((table) => table.rows.length)
    .slice(0, 8);

  const norm = (s) => clean(s).toLowerCase();
  const wanted = (detailTexts || []).map(norm);
  const links = Array.from(document.querySelectorAll("a, button, [role='button']"));
  const detailUrls = [];
  for (const el of links) {
    const label = norm(el.innerText || el.textContent || el.getAttribute("aria-label"));
    if (!wanted.some((w) => label.includes(w))) continue;
    const href = el.href || el.closest("a")?.href || el.querySelector?.("a[href]")?.href || "";
    if (href && href.startsWith("https://search.google.com/")) detailUrls.push(href);
  }

  const classify = (url, label) => {
    try {
      const u = new URL(url, location.href);
      u.hash = "";
      for (const key of Array.from(u.searchParams.keys())) {
        if (/^utm_/i.test(key) || ["hl", "pli", "original_url", "original_resource_id"].includes(key)) u.searchParams.delete(key);
      }
      const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
      u.search = "";
      for (const [key, value] of params) u.searchParams.append(key, value);
      const path = u.pathname;
      const joined = `${path} ${label || ""}`.toLowerCase();
      const blocked = /settings|achievements|url-inspection|feedback|about search console|privacy|term|accounts\.google\.com|support\.google\.com/i;
      if (blocked.test(u.href) || blocked.test(joined)) return null;
      const rules = [
        { type: "overview", priority: 1, re: /\/search-console\/?$/ },
        { type: "performance-insights", priority: 2, re: /\/performance\/insights/ },
        { type: "performance-search-analytics", priority: 3, re: /\/performance\/search-analytics|search results/ },
        { type: "performance-discover", priority: 4, re: /\/performance\/discover|\bdiscover\b/ },
        { type: "page-indexing", priority: 5, re: /\/search-console\/index|pages|indexing/ },
        { type: "video-indexing", priority: 6, re: /\/video-index|videos/ },
        { type: "sitemaps", priority: 7, re: /\/sitemaps|sitemaps/ },
        { type: "core-web-vitals", priority: 8, re: /\/core-web-vitals|core web vitals/ },
        { type: "https", priority: 9, re: /\/https|https/ },
        { type: "product-snippets", priority: 10, re: /\/r\/product|product snippets/ },
        { type: "merchant-listings", priority: 11, re: /\/r\/merchant-listings|merchant listings/ },
        { type: "breadcrumbs", priority: 12, re: /\/r\/breadcrumbs|breadcrumbs/ },
        { type: "faq", priority: 13, re: /\/r\/faq|\bfaq\b/ },
        { type: "review-snippets", priority: 14, re: /\/r\/review-snippet|review snippets/ },
        { type: "amp", priority: 15, re: /\/amp\b|\bamp\b/ },
        { type: "links", priority: 16, re: /\/links|\blinks\b/ },
        { type: "removals", priority: 17, re: /\/removals|removals/ },
        { type: "manual-actions", priority: 18, re: /\/manual-actions|manual actions/ },
        { type: "security-issues", priority: 19, re: /\/security-issues|security issues/ },
        { type: "detail", priority: 25, re: /drilldown|review issues|open report|full report|view details/ }
      ];
      const match = rules.find((rule) => rule.re.test(joined));
      return match ? { ...match, url: u.href, label: clean(label) || match.type } : null;
    } catch {
      return null;
    }
  };
  const discoveredByUrl = new Map();
  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const label = clean(anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "");
    const href = anchor.getAttribute("href") || "";
    let absolute = "";
    try {
      absolute = new URL(href, location.href).href;
    } catch {
      continue;
    }
    if (!absolute.startsWith("https://search.google.com/") || !absolute.includes("/search-console")) continue;
    const report = classify(absolute, label);
    if (!report) continue;
    if (!discoveredByUrl.has(report.url)) discoveredByUrl.set(report.url, report);
  }
  const discoveredReports = Array.from(discoveredByUrl.values())
    .sort((a, b) => (a.priority - b.priority) || a.url.localeCompare(b.url))
    .slice(0, 60);

  return {
    title,
    url: location.href,
    headings,
    metrics,
    tables,
    discoveredReports,
    textSnapshot: text.slice(0, 5000),
    detailUrls: Array.from(new Set([...detailUrls, ...discoveredReports.map((report) => report.url)])).slice(0, 40)
  };
}

function pageHasCwvContent() {
  const text = document.body?.innerText || "";
  const ok = /core web vitals|网址核心指标|mobile|desktop|why urls aren't considered good|url groups/i.test(text);
  return { ok, url: location.href, error: ok ? "" : "Core Web Vitals content not found" };
}

function pageGetCwvStartState() {
  const text = document.body?.innerText || "";
  const lower = text.toLowerCase();
  const params = new URL(location.href).searchParams;
  const deviceParam = params.get("device");
  const currentDevice = deviceParam === "2" ? "Mobile" : deviceParam === "1" ? "Desktop" : "";
  const devices = [];
  if (/\bmobile\b/i.test(text)) devices.push("Mobile");
  if (/\bdesktop\b/i.test(text)) devices.push("Desktop");
  const isSummary = location.pathname.includes("/core-web-vitals/summary") || (/open report|打开报告/i.test(text) && devices.length > 1 && !/why urls aren't considered good/i.test(lower));
  return { ok: true, isSummary, devices: Array.from(new Set(devices)), currentDevice, url: location.href };
}

function pageClickCwvDeviceReport(deviceName) {
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const wantedDevice = norm(deviceName);
  const openLabels = ["open report", "打开报告"];
  const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], div[tabindex], span[tabindex]'))
    .filter((el) => visible(el) && openLabels.some((label) => norm(el.innerText || el.textContent || el.getAttribute("aria-label")).includes(label)));

  const nearestDeviceAncestor = (el) => {
    let node = el;
    for (let i = 0; i < 10 && node; i++) {
      const text = norm(node.innerText || node.textContent || "");
      const hasOpenReport = openLabels.some((label) => text.includes(label));
      if (node !== document.body && hasOpenReport && text.length < 6000) {
        const hasMobile = text.includes("mobile");
        const hasDesktop = text.includes("desktop");
        if (hasMobile && !hasDesktop) return "mobile";
        if (hasDesktop && !hasMobile) return "desktop";
      }
      node = node.parentElement;
    }
    return "";
  };

  let button = candidates.find((el) => nearestDeviceAncestor(el) === wantedDevice);
  if (!button && candidates.length) {
    const fallbackIndex = wantedDevice.includes("desktop") ? 1 : 0;
    button = candidates[Math.min(fallbackIndex, candidates.length - 1)];
  }
  if (!button) return { ok: false, error: `Open report button not found for ${deviceName}` };
  button.scrollIntoView({ block: "center", inline: "center" });
  button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  button.click();
  return { ok: true, device: deviceName, text: button.innerText || button.textContent || button.getAttribute("aria-label") || "" };
}

function pageHasCwvIssueTable() {
  const rows = Array.from(document.querySelectorAll("tbody tr"));
  const issueRows = rows.filter((row) => row.querySelector('[data-label="issue"]') || /inp issue|lcp issue|cls issue/i.test(row.innerText || ""));
  const text = document.body?.innerText || "";
  const ok = issueRows.length > 0 && (/why urls aren't considered good|severity|validation|urls/i.test(text));
  return { ok, rows: issueRows.length, url: location.href, error: ok ? "" : "Core Web Vitals issue table not found" };
}

function pageExtractCwvIssueRows() {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const cellText = (row, label, fallbackIndex) => {
    const cell = row.querySelector(`[data-label="${label}"]`) || Array.from(row.querySelectorAll("td"))[fallbackIndex];
    if (!cell) return "";
    return clean(cell.getAttribute("data-string-value") || cell.getAttribute("data-numeric-value") || cell.innerText || cell.textContent || "");
  };
  const rows = Array.from(document.querySelectorAll("tbody tr"))
    .map((row, index) => {
      const issue = cellText(row, "issue", 1);
      if (!issue || !/issue|问题|inp|lcp|cls/i.test(issue)) return null;
      return {
        rowIndex: Number(row.getAttribute("data-rowid") || index),
        severity: cellText(row, "severity", 0),
        issue,
        validation: cellText(row, "task_status", 2),
        urls: cellText(row, "URLs", 4) || cellText(row, "urls", 4)
      };
    })
    .filter(Boolean);
  return { ok: rows.length > 0, rows, url: location.href, error: rows.length ? "" : "No issue rows found" };
}

function pageClickCwvIssueRow(issueText, rowIndex) {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const rows = Array.from(document.querySelectorAll("tbody tr"));
  const wanted = clean(issueText).toLowerCase();
  let row = rows.find((candidate) => {
    const issueCell = candidate.querySelector('[data-label="issue"]');
    const text = clean(issueCell?.getAttribute("data-string-value") || issueCell?.innerText || "");
    return text && text.toLowerCase() === wanted;
  });
  if (!row) {
    row = rows.find((candidate, index) => Number(candidate.getAttribute("data-rowid") || index) === Number(rowIndex));
  }
  if (!row) return { ok: false, error: `Issue row not found: ${issueText}` };
  row.scrollIntoView({ block: "center", inline: "center" });
  row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  row.click();
  return { ok: true, issue: issueText };
}

function pageHasCwvUrlGroupsTable() {
  const text = document.body?.innerText || "";
  const hasHeading = /url groups|网址组/i.test(text);
  const hasUrlRows = Array.from(document.querySelectorAll("tbody tr")).some((row) => /https?:\/\//i.test(row.innerText || ""));
  const ok = hasHeading && hasUrlRows;
  return { ok, url: location.href, error: ok ? "" : "URL groups table not found" };
}

function pageScrollToCwvIssueTable() {
  const table = Array.from(document.querySelectorAll("table")).find((candidate) => /severity|issue|validation|urls/i.test(candidate.innerText || ""));
  if (table) table.scrollIntoView({ block: "start", inline: "nearest" });
  return { ok: !!table };
}

function pageScrollToCwvUrlGroupsTable() {
  const table = Array.from(document.querySelectorAll("table")).find((candidate) => /example url|group population|group (inp|lcp|cls)/i.test(candidate.innerText || ""));
  if (table) table.scrollIntoView({ block: "start", inline: "nearest" });
  return { ok: !!table };
}

function pageExtractCwvUrlGroups(issue) {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const cleanCell = (cell) => {
    const raw = clean(cell.getAttribute("data-string-value") || cell.getAttribute("data-numeric-value") || cell.innerText || cell.textContent || "");
    if (!/https?:\/\//i.test(raw)) return raw;
    const compact = raw.replace(/\s+/g, "");
    const match = compact.match(/https?:\/\/.+/i);
    return match ? match[0] : compact;
  };
  const extractTable = (table) => {
    const headers = Array.from(table.querySelectorAll("thead th, tr th")).map((th) => clean(th.innerText || th.textContent || th.getAttribute("data-name") || th.getAttribute("data-label")));
    const bodyRows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.querySelectorAll("td").length);
    const values = bodyRows.map((row) => Array.from(row.querySelectorAll("td")).map(cleanCell)).filter((row) => row.some(Boolean));
    return { table, headers, values, text: clean(table.innerText || "") };
  };
  const tables = Array.from(document.querySelectorAll("table")).map(extractTable);
  const selected = tables.find((table) => /example url|group population|group (inp|lcp|cls)/i.test(table.headers.join(" ")))
    || tables.find((table) => /https?:\/\//i.test(table.text) && /group/i.test(table.text))
    || tables.find((table) => /https?:\/\//i.test(table.text));
  if (!selected) return { ok: false, error: "URL groups table not found", url: location.href, rows: [] };

  const headers = selected.headers.length ? selected.headers : ["Example URL", "Group population", "Metric"];
  const headerNorms = headers.map((header) => header.toLowerCase());
  const urlIndex = Math.max(0, headerNorms.findIndex((header) => header.includes("example url") || header.includes("url")));
  const populationIndex = headerNorms.findIndex((header) => header.includes("population"));
  const metricIndex = headerNorms.findIndex((header) => /group (inp|lcp|cls)|inp|lcp|cls/.test(header));
  const rows = selected.values.map((values) => ({
    exampleUrl: values[urlIndex] || values.find((value) => /^https?:\/\//i.test(value)) || "",
    groupPopulation: populationIndex >= 0 ? values[populationIndex] || "" : "",
    metric: metricIndex >= 0 ? values[metricIndex] || "" : "",
    values
  })).filter((row) => row.exampleUrl || row.values.some(Boolean));

  const title = Array.from(document.querySelectorAll("h1,h2,h3"))
    .map((heading) => clean(heading.innerText || heading.textContent || ""))
    .find((heading) => /url groups|网址组/i.test(heading)) || "URL groups";
  const pagination = Array.from(document.querySelectorAll("div, span"))
    .map((el) => clean(el.innerText || el.textContent || ""))
    .find((value) => /^\d+\s*-\s*\d+\s+of\s+\d+$/i.test(value) || /^\d+\s*-\s*\d+\s*\/\s*\d+$/i.test(value)) || "";
  return {
    ok: rows.length > 0,
    url: location.href,
    title,
    issue,
    headers,
    metricColumn: metricIndex >= 0 ? headers[metricIndex] : "",
    pagination,
    rows
  };
}

function pageClickCwvUrlGroupsNextPage() {
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const isDisabled = (el) => el.disabled || el.getAttribute("aria-disabled") === "true" || el.classList.contains("disabled");
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'))
    .filter((el) => visible(el) && !isDisabled(el));
  const next = buttons.find((el) => {
    const label = norm(el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.textContent || "");
    return /next page|go to next|下一页|后页|下一個/.test(label);
  });
  if (!next) return { ok: false, error: "Next page button not found" };
  next.scrollIntoView({ block: "center", inline: "center" });
  next.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  next.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  next.click();
  return { ok: true };
}

function pageHasIndexingContent() {
  const text = document.body?.innerText || "";
  const ok = /page indexing|pages aren't indexed|why pages aren.t indexed|examples|last crawled|页面|索引/i.test(text);
  return { ok, url: location.href, error: ok ? "" : "Page Indexing content not found" };
}

function pageGetIndexingStartState() {
  const text = document.body?.innerText || "";
  const isDrilldown = location.pathname.includes("/search-console/index/drilldown") || (/examples/i.test(text) && /last crawled/i.test(text));
  return { ok: true, isDrilldown, url: location.href };
}

function pageHasIndexingReasonTable() {
  const rows = Array.from(document.querySelectorAll("tbody tr"));
  const reasonRows = rows.filter((row) => {
    const text = row.innerText || "";
    return /failed|not started|passed|n\/a|website|google systems/i.test(text) && row.querySelectorAll("td").length >= 5;
  });
  const text = document.body?.innerText || "";
  const ok = reasonRows.length > 0 && /reason|source|validation|pages|why pages/i.test(text);
  return { ok, rows: reasonRows.length, url: location.href, error: ok ? "" : "Page Indexing reason table not found" };
}

function pageExtractIndexingReasonRows(pageNumber = 1) {
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const cellText = (cell) => {
    if (!cell) return "";
    return clean(cell.getAttribute("data-string-value") || cell.getAttribute("data-numeric-value") || cell.innerText || cell.textContent || "");
  };
  const rows = Array.from(document.querySelectorAll("tbody tr"))
    .filter((row) => visible(row) && row.querySelectorAll("td").length >= 5)
    .map((row, index) => {
      const cells = Array.from(row.querySelectorAll("td"));
      const reason = cellText(cells[0]);
      const source = cellText(cells[1]);
      const validation = cellText(cells[2]);
      const pages = cellText(cells[4]);
      if (!reason || !source || !pages) return null;
      return {
        rowIndex: Number(row.getAttribute("data-rowid") || index),
        pageNumber,
        reason,
        source,
        validation,
        pages
      };
    })
    .filter(Boolean);
  return { ok: rows.length > 0, rows, url: location.href, error: rows.length ? "" : "No indexing reason rows found" };
}

function pageClickIndexingReasonRow(reasonText, rowIndex) {
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const wanted = clean(reasonText).toLowerCase();
  const rows = Array.from(document.querySelectorAll("tbody tr")).filter(visible);
  let row = rows.find((candidate) => {
    const firstCell = candidate.querySelector("td");
    const text = clean(firstCell?.getAttribute("data-string-value") || firstCell?.innerText || "");
    return text && text.toLowerCase() === wanted;
  });
  if (!row) {
    row = rows.find((candidate, index) => Number(candidate.getAttribute("data-rowid") || index) === Number(rowIndex));
  }
  if (!row) return { ok: false, error: `Reason row not found: ${reasonText}` };
  row.scrollIntoView({ block: "center", inline: "center" });
  row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  row.click();
  return { ok: true, reason: reasonText };
}

function pageHasIndexingExamplesTable() {
  const text = document.body?.innerText || "";
  const hasHeading = /examples|示例/i.test(text);
  const hasUrlRows = Array.from(document.querySelectorAll("tbody tr")).some((row) => /https?:\/\//i.test(row.innerText || ""));
  const ok = hasHeading && hasUrlRows;
  return { ok, url: location.href, error: ok ? "" : "Page Indexing examples table not found" };
}

function pageScrollToIndexingReasonTable() {
  const table = Array.from(document.querySelectorAll("table")).find((candidate) => /reason|source|validation|pages/i.test(candidate.innerText || ""));
  if (table) table.scrollIntoView({ block: "start", inline: "nearest" });
  return { ok: !!table };
}

function pageScrollToIndexingExamplesTable() {
  const table = Array.from(document.querySelectorAll("table")).find((candidate) => /url|last crawled|https?:\/\//i.test(candidate.innerText || ""));
  if (table) table.scrollIntoView({ block: "start", inline: "nearest" });
  return { ok: !!table };
}

function pageExtractIndexingExamples(reason) {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const cleanCell = (cell) => {
    const raw = clean(cell.getAttribute("data-string-value") || cell.getAttribute("data-numeric-value") || cell.innerText || cell.textContent || "");
    if (!/https?:\/\//i.test(raw)) return raw;
    const compact = raw.replace(/\s+/g, "");
    const match = compact.match(/https?:\/\/.+/i);
    return match ? match[0] : compact;
  };
  const extractTable = (table) => {
    const headers = Array.from(table.querySelectorAll("thead th, tr th")).map((th) => clean(th.innerText || th.textContent || th.getAttribute("data-name") || th.getAttribute("data-label")));
    const bodyRows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.querySelectorAll("td").length);
    const values = bodyRows.map((row) => Array.from(row.querySelectorAll("td")).map(cleanCell)).filter((row) => row.some(Boolean));
    return { table, headers, values, text: clean(table.innerText || "") };
  };
  const tables = Array.from(document.querySelectorAll("table")).map(extractTable);
  const selected = tables.find((table) => /last crawled/i.test(table.headers.join(" ")) && /https?:\/\//i.test(table.text))
    || tables.find((table) => /examples/i.test(table.text) && /https?:\/\//i.test(table.text))
    || tables.find((table) => /https?:\/\//i.test(table.text));
  if (!selected) return { ok: false, error: "Examples table not found", url: location.href, rows: [] };

  const headers = selected.headers.length ? selected.headers : ["URL", "Last crawled"];
  const headerNorms = headers.map((header) => header.toLowerCase());
  const urlIndex = Math.max(0, headerNorms.findIndex((header) => header === "url" || header.includes("url")));
  const crawledIndex = headerNorms.findIndex((header) => header.includes("last crawled") || header.includes("最后"));
  const rows = selected.values.map((values) => ({
    url: values[urlIndex] || values.find((value) => /^https?:\/\//i.test(value)) || "",
    lastCrawled: crawledIndex >= 0 ? values[crawledIndex] || "" : "",
    values
  })).filter((row) => row.url || row.values.some(Boolean));

  const title = Array.from(document.querySelectorAll("h1,h2,h3"))
    .map((heading) => clean(heading.innerText || heading.textContent || ""))
    .find((heading) => /examples|示例/i.test(heading)) || "Examples";
  const reasonTitle = Array.from(document.querySelectorAll("h1,h2,h3"))
    .map((heading) => clean(heading.innerText || heading.textContent || ""))
    .find((heading) => heading && !/examples|示例/i.test(heading)) || reason?.reason || "";
  const pagination = Array.from(document.querySelectorAll("div, span"))
    .map((el) => clean(el.innerText || el.textContent || ""))
    .find((value) => /^\d+\s*-\s*\d+\s+of\s+\d+$/i.test(value) || /^\d+\s*-\s*\d+\s*\/\s*\d+$/i.test(value)) || "";
  return {
    ok: rows.length > 0,
    url: location.href,
    title,
    reason: reasonTitle,
    headers,
    pagination,
    rows
  };
}

function pageClickIndexingReasonNextPage() {
  return pageClickGscTableNextPage("Reason table next page button not found");
}

function pageClickIndexingExamplesNextPage() {
  return pageClickGscTableNextPage("Examples next page button not found");
}

function pageClickGscTableNextPage(error) {
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const isDisabled = (el) => el.disabled || el.getAttribute("aria-disabled") === "true" || el.classList.contains("disabled");
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'))
    .filter((el) => visible(el) && !isDisabled(el));
  const next = buttons.find((el) => {
    const label = norm(el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.textContent || "");
    return /next page|go to next|下一页|后页|下一個/.test(label);
  });
  if (!next) return { ok: false, error };
  next.scrollIntoView({ block: "center", inline: "center" });
  next.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  next.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  next.click();
  return { ok: true };
}

function pageHasPerformanceInsightsContent() {
  const text = document.body?.innerText || "";
  const ok = /your content|insights|top|trending up|trending down/i.test(text) && /https?:\/\//i.test(text);
  return { ok, url: location.href, error: ok ? "" : "Performance Insights content not found" };
}

function pageScrollToPerformanceInsightsContent() {
  const candidates = Array.from(document.querySelectorAll("h1,h2,h3,div,section"));
  const section = candidates.find((el) => /your content/i.test(el.innerText || el.textContent || ""))
    || candidates.find((el) => /https?:\/\//i.test(el.innerText || el.textContent || ""));
  if (section) section.scrollIntoView({ block: "start", inline: "nearest" });
  return { ok: !!section };
}

function pageExtractPerformanceInsightsContent(target) {
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const cleanUrl = (value) => (value || "").replace(/[),.;]+$/g, "");
  const parseRow = (text, order) => {
    const urlMatch = text.match(/https?:\/\/[^\s<>"')\]]+/i);
    if (!urlMatch) return null;
    const url = cleanUrl(urlMatch[0]);
    const lines = (text.split(/\n+/).map(clean).filter(Boolean).length
      ? text.split(/\n+/).map(clean).filter(Boolean)
      : text.split(/\s{2,}/).map(clean).filter(Boolean));
    const urlLineIndex = lines.findIndex((line) => line.includes(urlMatch[0]) || line.includes(url));
    let title = "";
    if (urlLineIndex > 0) title = lines[urlLineIndex - 1];
    if (!title) {
      const beforeUrl = clean(text.slice(0, urlMatch.index));
      title = beforeUrl.split(/\n+/).map(clean).filter(Boolean).pop() || "";
    }
    if (!title) title = lines.find((line) => !line.includes("http") && !/^[↓↑+-]?\s*\d/.test(line)) || "";
    const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const deltaMatch = text.match(/(?:^|\s)([-+]\s*\d[\d,]*)\s*$/) || text.match(/%\s*([-+]\s*\d[\d,]*)/);
    const numberMatches = Array.from(text.matchAll(/[-+]?\d[\d,]*/g)).map((match) => match[0]);
    const direction = /↓|down/i.test(text) || target?.contentTab === "TRENDING_DOWN"
      ? "down"
      : (/↑|up/i.test(text) || target?.contentTab === "TRENDING_UP" ? "up" : "");
    return {
      order,
      title: title || url,
      url,
      direction,
      changePercent: percentMatch ? `${percentMatch[1]}%` : "",
      clickDelta: deltaMatch ? deltaMatch[1].replace(/\s+/g, "") : "",
      clicks: !deltaMatch && numberMatches.length ? numberMatches[numberMatches.length - 1] : "",
      text
    };
  };

  const elements = Array.from(document.querySelectorAll("a, div, li, tr, [role='row']"))
    .filter((el) => visible(el))
    .map((el, order) => ({ el, order, text: (el.innerText || el.textContent || "").trim() }))
    .filter((item) => /https?:\/\//i.test(item.text) && item.text.length < 1400);
  const byUrl = new Map();
  for (const item of elements) {
    const parsed = parseRow(item.text, item.order);
    if (!parsed) continue;
    const existing = byUrl.get(parsed.url);
    const score = (parsed.title && parsed.title !== parsed.url ? 1000 : 0)
      + (parsed.changePercent || parsed.clickDelta || parsed.clicks ? 200 : 0)
      + (item.text.length > 40 ? 50 : 0)
      - Math.abs(item.text.length - 260) / 10;
    if (!existing || score > existing.score) byUrl.set(parsed.url, { ...parsed, score });
  }

  const rows = Array.from(byUrl.values())
    .sort((a, b) => a.order - b.order)
    .map(({ score, ...row }) => row)
    .slice(0, 100);
  const activeTab = Array.from(document.querySelectorAll('[aria-selected="true"], [role="tab"], a, button'))
    .map((el) => clean(el.innerText || el.textContent || el.getAttribute("aria-label") || ""))
    .find((label) => /top|trending up|trending down/i.test(label)) || "";
  return {
    ok: rows.length > 0,
    url: location.href,
    title: document.title || "Performance Insights",
    activeTab,
    pagination: "",
    rows,
    error: rows.length ? "" : "No Performance Insights content rows found"
  };
}

function pageHasPerformanceSearchAnalyticsTable() {
  const text = document.body?.innerText || "";
  const ok = /clicks|impressions|position|pages|page/i.test(text) && /https?:\/\//i.test(text);
  return { ok, url: location.href, error: ok ? "" : "Performance Search Analytics table not found" };
}

function pageScrollToPerformanceSearchAnalyticsTable() {
  const table = Array.from(document.querySelectorAll("table")).find((candidate) => /clicks|impressions|position|https?:\/\//i.test(candidate.innerText || ""));
  if (table) table.scrollIntoView({ block: "start", inline: "nearest" });
  return { ok: !!table };
}

function pageExtractPerformanceSearchAnalyticsRows() {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const cleanCell = (cell) => {
    const raw = clean(cell.getAttribute("data-string-value") || cell.getAttribute("data-numeric-value") || cell.innerText || cell.textContent || "");
    if (!/https?:\/\//i.test(raw)) return raw;
    const compact = raw.replace(/\s+/g, "");
    const match = compact.match(/https?:\/\/.+/i);
    return match ? match[0] : compact;
  };
  const extractTable = (table) => {
    const headers = Array.from(table.querySelectorAll("thead th, tr th")).map((th) => clean(th.innerText || th.textContent || th.getAttribute("data-name") || th.getAttribute("data-label")));
    const bodyRows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.querySelectorAll("td").length);
    const values = bodyRows.map((row) => Array.from(row.querySelectorAll("td")).map(cleanCell)).filter((row) => row.some(Boolean));
    return { headers, values, text: clean(table.innerText || "") };
  };
  const tables = Array.from(document.querySelectorAll("table")).map(extractTable);
  const selected = tables.find((table) => /clicks|impressions|position/i.test(table.headers.join(" ")) && /https?:\/\//i.test(table.text))
    || tables.find((table) => /https?:\/\//i.test(table.text));
  if (!selected) return { ok: false, error: "Search Analytics table not found", url: location.href, rows: [] };
  const headers = selected.headers.length ? selected.headers : ["Page", "Clicks"];
  const rows = selected.values.map((values) => {
    const url = values.find((value) => /^https?:\/\//i.test(value)) || "";
    return { url, values };
  }).filter((row) => row.url || row.values.some(Boolean)).slice(0, 200);
  const pagination = Array.from(document.querySelectorAll("div, span"))
    .map((el) => clean(el.innerText || el.textContent || ""))
    .find((value) => /^\d+\s*-\s*\d+\s+of\s+\d+$/i.test(value) || /^\d+\s*-\s*\d+\s*\/\s*\d+$/i.test(value)) || "";
  return { ok: rows.length > 0, url: location.href, headers, rows, pagination, error: rows.length ? "" : "No Search Analytics rows found" };
}

async function runInTab(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result?.result;
}

async function exportSubmitLog() {
  const data = await chrome.storage.local.get(GSC_STORAGE_KEYS.submitJob);
  const job = data[GSC_STORAGE_KEYS.submitJob];
  if (!job) return setSubmitStatus("暂无日志");
  const file = `lily-gsc-submit-log-${new Date().toISOString().slice(0, 10)}.json`;
  await downloadTextFile(file, JSON.stringify(job, null, 2), "application/json;charset=utf-8");
  setSubmitStatus("已导出日志");
}

function buildPageMarkdown(page) {
  const extracted = page.extracted || {};
  const metrics = extracted.metrics || [];
  const headings = extracted.headings || [];
  const discovered = extracted.discoveredReports || [];
  const tables = extracted.tables || [];
  const lines = [
    `# ${page.title}`,
    "",
    `URL: ${page.url}`,
    "",
    `Depth: ${page.depth}`,
    "",
    `Screenshot: ./${page.screenshot.split("/").pop()}`,
    "",
    "## Key metrics",
    "",
    metrics.map((x) => `- ${x}`).join("\n") || "- No metrics extracted",
    "",
    "## Headings",
    "",
    headings.map((x) => `- ${x}`).join("\n") || "- No headings extracted",
    "",
    "## Discovered GSC reports",
    "",
    discovered.length ? discovered.map((report) => `- ${report.label || report.type}: ${report.url}`).join("\n") : "- No GSC report links discovered",
    ""
  ];

  if (tables.length) {
    lines.push("## Tables", "");
    for (const table of tables) {
      const headers = table.headers?.length ? table.headers : (table.rows?.[0] || []).map((_, index) => `Column ${index + 1}`);
      lines.push(`### ${table.caption || "Table"}`, "");
      lines.push(`| ${headers.map(escapeTable).join(" | ")} |`);
      lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
      for (const row of table.rows || []) {
        const normalized = headers.map((_, index) => row[index] || "");
        lines.push(`| ${normalized.map(escapeTable).join(" | ")} |`);
      }
      lines.push("");
    }
  }

  lines.push("## Text snapshot", "", "```text", (extracted.textSnapshot || "").slice(0, 4000), "```", "");
  return lines.join("\n");
}

function buildCoreWebVitalsMarkdown(report) {
  const lines = [
    "# Core Web Vitals Drilldown",
    "",
    `Source: ${report.url}`,
    `Generated at: ${new Date().toLocaleString()}`,
    ""
  ];

  for (const device of report.devices || []) {
    lines.push(`## ${device.name}`, "");
    if (device.issueReportUrl) lines.push(`Issue report: ${device.issueReportUrl}`, "");
    if (device.issueScreenshot) lines.push(`Issue screenshot: ./${device.issueScreenshot.split("/").pop()}`, "");
    if (device.errors?.length) {
      lines.push("Errors:", ...device.errors.map((error) => `- ${error}`), "");
    }

    lines.push("| Severity | Issue | Validation | URLs | URL Groups |");
    lines.push("|---|---|---|---:|---:|");
    for (const issue of device.issues || []) {
      lines.push(`| ${escapeTable(issue.severity)} | ${escapeTable(issue.issue)} | ${escapeTable(issue.validation)} | ${escapeTable(issue.urls)} | ${issue.urlGroups?.length || 0} |`);
    }
    if (!device.issues?.length) lines.push("| - | - | - | - | - |");
    lines.push("");

    for (const issue of device.issues || []) {
      lines.push(`### ${issue.issue || "Issue"}`, "");
      lines.push(`Severity: ${issue.severity || "-"}`);
      lines.push(`Validation: ${issue.validation || "-"}`);
      lines.push(`URLs: ${issue.urls || "-"}`);
      if (issue.detailUrl) lines.push(`Detail URL: ${issue.detailUrl}`);
      if (issue.detailScreenshot) lines.push(`Screenshot: ./${issue.detailScreenshot.split("/").pop()}`);
      if (issue.pagination) lines.push(`Pagination: ${issue.pagination}`);
      if (issue.error) lines.push(`Error: ${issue.error}`);
      lines.push("");

      const headers = issue.urlGroupHeaders?.length ? issue.urlGroupHeaders : ["Example URL", "Group population", issue.metricColumn || "Metric"];
      lines.push(`| ${headers.map(escapeTable).join(" | ")} |`);
      lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
      for (const row of issue.urlGroups || []) {
        const values = row.values?.length ? row.values : [row.exampleUrl, row.groupPopulation, row.metric];
        const normalized = headers.map((_, index) => values[index] || "");
        lines.push(`| ${normalized.map(escapeTable).join(" | ")} |`);
      }
      if (!issue.urlGroups?.length) lines.push(`| ${headers.map(() => "-").join(" | ")} |`);
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function buildPageIndexingMarkdown(report) {
  const lines = [
    "# Page Indexing Drilldown",
    "",
    `Source: ${report.url}`,
    `Generated at: ${new Date().toLocaleString()}`,
    ""
  ];

  if (report.reasonReportUrl) lines.push(`Reason report: ${report.reasonReportUrl}`, "");
  if (report.reasonScreenshot) lines.push(`Reason screenshot: ./${report.reasonScreenshot.split("/").pop()}`, "");
  if (report.errors?.length) lines.push("Errors:", ...report.errors.map((error) => `- ${error}`), "");

  lines.push("| Reason | Source | Validation | Pages | Examples |");
  lines.push("|---|---|---|---:|---:|");
  for (const reason of report.reasons || []) {
    lines.push(`| ${escapeTable(reason.reason)} | ${escapeTable(reason.source)} | ${escapeTable(reason.validation)} | ${escapeTable(reason.pages)} | ${reason.examples?.length || 0} |`);
  }
  if (!report.reasons?.length) lines.push("| - | - | - | - | - |");
  lines.push("");

  for (const reason of report.reasons || []) {
    lines.push(`## ${reason.reason || "Reason"}`, "");
    lines.push(`Source: ${reason.source || "-"}`);
    lines.push(`Validation: ${reason.validation || "-"}`);
    lines.push(`Pages: ${reason.pages || "-"}`);
    if (reason.detailUrl) lines.push(`Detail URL: ${reason.detailUrl}`);
    if (reason.detailScreenshot) lines.push(`Screenshot: ./${reason.detailScreenshot.split("/").pop()}`);
    if (reason.pagination) lines.push(`Pagination: ${reason.pagination}`);
    if (reason.error) lines.push(`Error: ${reason.error}`);
    lines.push("");

    const headers = reason.exampleHeaders?.length ? reason.exampleHeaders : ["URL", "Last crawled"];
    lines.push(`| ${headers.map(escapeTable).join(" | ")} |`);
    lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
    for (const row of reason.examples || []) {
      const values = row.values?.length ? row.values : [row.url, row.lastCrawled];
      const normalized = headers.map((_, index) => values[index] || "");
      lines.push(`| ${normalized.map(escapeTable).join(" | ")} |`);
    }
    if (!reason.examples?.length) lines.push(`| ${headers.map(() => "-").join(" | ")} |`);
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function buildPerformanceInsightsMarkdown(report) {
  const lines = [
    "# Performance Insights Drilldown",
    "",
    `Source: ${report.url}`,
    `Generated at: ${new Date().toLocaleString()}`,
    ""
  ];

  for (const target of report.targets || []) {
    lines.push(`## ${target.label}`, "");
    lines.push(`Content URL: ${target.contentUrl}`);
    if (target.searchAnalyticsUrl) lines.push(`Search Analytics URL: ${target.searchAnalyticsUrl}`);
    if (target.screenshot) lines.push(`Screenshot: ./${target.screenshot.split("/").pop()}`);
    if (target.activeTab) lines.push(`Active tab: ${target.activeTab}`);
    if (target.errors?.length) lines.push("Errors:", ...target.errors.map((error) => `- ${error}`));
    lines.push("");

    lines.push("| Title | URL | Direction | Change | Click Delta | Clicks |");
    lines.push("|---|---|---|---:|---:|---:|");
    for (const row of target.rows || []) {
      lines.push(`| ${escapeTable(row.title)} | ${escapeTable(row.url)} | ${escapeTable(row.direction)} | ${escapeTable(row.changePercent)} | ${escapeTable(row.clickDelta)} | ${escapeTable(row.clicks)} |`);
    }
    if (!target.rows?.length) lines.push("| - | - | - | - | - | - |");
    lines.push("");

    if (target.searchAnalyticsRows?.length) {
      lines.push("### Search Analytics Page Breakdown", "");
      if (target.searchAnalyticsScreenshot) lines.push(`Screenshot: ./${target.searchAnalyticsScreenshot.split("/").pop()}`, "");
      if (target.searchAnalyticsPagination) lines.push(`Pagination: ${target.searchAnalyticsPagination}`, "");
      const headers = target.searchAnalyticsHeaders?.length ? target.searchAnalyticsHeaders : ["Page", "Clicks"];
      lines.push(`| ${headers.map(escapeTable).join(" | ")} |`);
      lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
      for (const row of target.searchAnalyticsRows || []) {
        const values = headers.map((_, index) => row.values?.[index] || "");
        lines.push(`| ${values.map(escapeTable).join(" | ")} |`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

async function buildAiGscReportSummary(job) {
  try {
    const res = await chrome.runtime.sendMessage({ type: "LR_BUILD_GSC_REPORT_INSIGHTS", job: slimGscReportJobForAi(job) });
    if (res?.ok) return { ok: true, ai: res.ai };
    return { ok: false, error: res?.error || "AI report summary failed" };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function slimGscReportJobForAi(job) {
  const slimRows = (rows, limit = 40) => (rows || []).slice(0, limit);
  return {
    type: job.type,
    status: job.status,
    folder: job.folder,
    urls: job.urls,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    pages: (job.pages || []).map((page) => ({
      title: page.title,
      url: page.url,
      requestedUrl: page.requestedUrl,
      status: page.status,
      metrics: (page.metrics || []).slice(0, 60),
      tables: (page.tables || []).slice(0, 5).map((table) => ({
        caption: table.caption,
        headers: table.headers || [],
        rows: slimRows(table.rows, 30)
      })),
      discoveredReports: (page.discoveredReports || []).slice(0, 30),
      error: page.error || "",
      screenshots: pageScreenshotFiles(page).map(reportFileName),
      markdownFiles: reportFilesByExtension(page.files || [], ".md").map(reportFileName),
      jsonFiles: reportFilesByExtension(page.files || [], ".json").map(reportFileName),
      coreWebVitals: page.cwv ? {
        devices: (page.cwv.devices || []).map((device) => ({
          name: device.name,
          issues: (device.issues || []).map((issue) => ({
            severity: issue.severity,
            issue: issue.issue,
            validation: issue.validation,
            urls: issue.urls,
            urlGroups: slimRows(issue.urlGroups, 25)
          })),
          errors: device.errors || []
        }))
      } : null,
      pageIndexing: page.indexing ? {
        reasons: (page.indexing.reasons || []).map((reason) => ({
          reason: reason.reason,
          source: reason.source,
          validation: reason.validation,
          pages: reason.pages,
          examples: slimRows(reason.examples, 30),
          error: reason.error || ""
        })),
        errors: page.indexing.errors || []
      } : null,
      performanceInsights: page.performanceInsights ? {
        targets: (page.performanceInsights.targets || []).map((target) => ({
          label: target.label,
          rows: slimRows(target.rows, 40),
          searchAnalyticsRows: slimRows(target.searchAnalyticsRows, 40),
          errors: target.errors || []
        })),
        errors: page.performanceInsights.errors || []
      } : null
    }))
  };
}

function buildIndexMarkdown(job) {
  const pages = job.pages || [];
  const rows = pages.map((p) => `| ${escapeTable(p.title)} | ${escapeTable(p.status)} | ${escapeTable((p.metrics || []).slice(0, 3).join("; "))} | ${reportFileLinks(pageScreenshotFiles(p))} |`).join("\n");
  const detailRows = pages.map((p) => {
    const files = p.files || [];
    return `| ${escapeTable(p.title)} | ${escapeTable(p.status)} | ${reportFileLinks(reportFilesByExtension(files, ".md"))} | ${reportFileLinks(reportFilesByExtension(files, ".json"))} | ${reportFileLinks(pageScreenshotFiles(p))} |`;
  }).join("\n");
  const allFiles = uniqueStrings(job.files || []).map((file) => `- ${markdownReportFileLink(file)}`).join("\n");
  const seedRows = (job.seedReports || []).map((seed) => `- ${seed.label}: ${seed.url}`).join("\n");
  const discoveredRows = uniqueStrings(pages.flatMap((p) => (p.discoveredReports || []).map((report) => `${report.label || report.type}: ${report.url}`)))
    .slice(0, 80)
    .map((row) => `- ${row}`)
    .join("\n");
  const followups = [];
  for (const p of pages) {
    const joined = (p.metrics || []).join(" ").toLowerCase();
    if (/not indexed|未编入|poor|较差|invalid|错误|needs improvement|需要改进/.test(joined)) followups.push(`Review ${p.title}: ${p.url}`);
  }
  const aiSection = job.aiSummary?.markdown
    ? `\n\n## AI Prioritized Summary\n\n${job.aiSummary.markdown.trim()}\n`
    : "";
  const crawlLimitSection = job.truncated
    ? `\n\n## Crawl Limit\n\nMax pages was reached before the queue was exhausted. Increase Max pages to continue.\n\n${(job.remainingQueue || []).map((item) => `- depth ${item.depth}: ${item.url}`).join("\n") || "- Remaining queue not recorded"}\n`
    : "";
  return `# GSC Report\n\nGenerated at: ${new Date().toLocaleString()}\n\nStatus: ${job.status || "running"}\n\nDownload folder: ${job.downloadFolder || `Downloads/${job.folder}`}\n\n这个总目录会链接本次导出的全部截图、Markdown 明细报告和 JSON 数据文件。\n${aiSection}${crawlLimitSection}\n## Summary\n\n| Report | Status | Key Findings | Screenshots |\n|---|---|---|---|\n${rows || "| - | - | - | - |"}\n\n## Detail Report Files\n\n| Report | Status | Detail Markdown | JSON Data | Screenshots |\n|---|---|---|---|---|\n${detailRows || "| - | - | - | - | - |"}\n\n## Follow-up Items\n\n${followups.map((x, i) => `${i + 1}. ${x}`).join("\n") || "No obvious follow-up items extracted."}\n\n## Seeded SEO/Growth Reports\n\n${seedRows || "- No default seed reports used"}\n\n## Discovered GSC Reports\n\n${discoveredRows || "- No discovered report links"}\n\n## Source URLs\n\n${(job.urls || []).map((u) => `- ${u}`).join("\n") || "- Current active GSC tab"}\n\n## All Downloaded Files\n\n${allFiles || "- No files exported"}\n`;
}

function reportFileName(file) {
  return (file || "").split("/").filter(Boolean).pop() || "";
}

function markdownReportFileLink(file) {
  const name = reportFileName(file);
  if (!name) return "-";
  const href = `./${name.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")}`;
  return `[${escapeMd(name)}](${href})`;
}

function reportFileLinks(files) {
  const links = uniqueStrings(files || []).map(markdownReportFileLink).filter(Boolean);
  return links.length ? links.join("<br>") : "-";
}

function reportFilesByExtension(files, extension) {
  const suffix = (extension || "").toLowerCase();
  return uniqueStrings(files || []).filter((file) => file.toLowerCase().endsWith(suffix));
}

function pageScreenshotFiles(page) {
  return uniqueStrings([page?.screenshot, ...((page?.files || []).filter((file) => file.toLowerCase().endsWith(".png")))].filter(Boolean));
}

async function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const url = `data:${mimeType},${encodeURIComponent(content)}`;
  return downloadNamedDataUrlFile(filename, url);
}

async function downloadDataUrlFile(filename, dataUrl) {
  return downloadNamedDataUrlFile(filename, dataUrl);
}

async function downloadNamedDataUrlFile(filename, dataUrl) {
  const normalized = normalizeDownloadFilename(filename);
  const response = await chrome.runtime.sendMessage({
    type: "LR_DOWNLOAD_NAMED_DATA_URL",
    filename: normalized,
    dataUrl
  });
  if (!response?.ok) throw new Error(response?.error || `Download failed: ${normalized}`);
  return response.downloadId;
}

function normalizeDownloadFilename(filename) {
  // Chrome downloads filename is relative to the browser's Downloads directory.
  return (filename || "").replace(/^\/+/, "").replace(/^Downloads\//i, "");
}

async function saveSubmitJob(job) {
  await chrome.storage.local.set({ [GSC_STORAGE_KEYS.submitJob]: job });
}

async function saveReportJob(job) {
  await chrome.storage.local.set({ [GSC_STORAGE_KEYS.reportJob]: job });
}

function renderParsedUrls(urls, results) {
  const host = document.getElementById("gscParsedUrls");
  if (!host) return;
  const byUrl = new Map((results || []).map((r) => [r.url, r]));
  host.innerHTML = (urls || []).slice(0, 120).map((url, i) => {
    const r = byUrl.get(url);
    const status = r ? `${r.status}: ${r.message || ""}` : "pending";
    return `<div style="padding:4px 0;border-top:1px solid rgba(255,255,255,.06);"><b>${i + 1}.</b> ${escapeHtml(url)}<br/><span class="muted">${escapeHtml(status)}</span></div>`;
  }).join("") || "—";
}

function renderReportFiles(files) {
  const host = document.getElementById("gscReportFiles");
  if (!host) return;
  host.innerHTML = (files || []).map((f) => `<div>${escapeHtml(f)}</div>`).join("") || "—";
}

function formatSubmitStatus(job) {
  const ok = (job.results || []).filter((x) => x.status === "success").length;
  const failed = (job.results || []).filter((x) => x.status === "failed").length;
  const skipped = (job.results || []).filter((x) => x.status === "skipped").length;
  return `${job.status || "running"}: ${job.results?.length || 0}/${job.total || job.urls?.length || 0}, success ${ok}, failed ${failed}, skipped ${skipped}`;
}

function formatReportStatus(job) {
  const displayFolder = job.downloadFolder || (job.folder ? `Downloads/${job.folder}` : GSC_REPORT_DOWNLOAD_DISPLAY_ROOT);
  return `${job.status || "running"}: pages ${(job.pages || []).length}, files ${(job.files || []).length}, folder ${displayFolder}`;
}

function setSubmitStatus(text) {
  const el = document.getElementById("gscSubmitStatus");
  if (el) el.textContent = text;
}

function setReportStatus(text) {
  const el = document.getElementById("gscReportStatus");
  if (el) el.textContent = text;
}

function valueOf(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function parseCsv(text) {
  return (text || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeSlug(value) {
  return (value || "report").toString().trim().toLowerCase().replace(/https?:\/\//g, "").replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "report";
}

function numberedReportSlug(index, ...parts) {
  const semantic = parts.map(safeSlug).filter(Boolean).join("-");
  return `${String(index).padStart(2, "0")}-${semantic || "gsc-report"}`.slice(0, 150).replace(/-$/g, "");
}

function reportTypeFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (path.includes("/core-web-vitals")) return "core-web-vitals";
    if (path.includes("/search-console/index/drilldown")) return "page-indexing-examples";
    if (path.includes("/search-console/index")) return "page-indexing";
    if (path.includes("/video-index")) return "video-indexing";
    if (path.includes("/performance/insights/content")) return "performance-insights-content";
    if (path.includes("/performance/search-analytics")) return "performance-search-analytics";
    if (path.includes("/performance/discover")) return "performance-discover";
    if (path.includes("/performance/insights")) return "performance-insights";
    if (path.includes("/sitemaps")) return "sitemaps";
    if (path.includes("/removals")) return "removals";
    if (path.includes("/https")) return "https";
    if (path.includes("/r/product")) return "product-snippets";
    if (path.includes("/r/merchant-listings")) return "merchant-listings";
    if (path.includes("/r/breadcrumbs")) return "breadcrumbs";
    if (path.includes("/r/faq")) return "faq";
    if (path.includes("/r/review-snippet")) return "review-snippets";
    if (path.includes("/amp")) return "amp";
    if (path.includes("/manual-actions")) return "manual-actions";
    if (path.includes("/security-issues")) return "security-issues";
    if (path.includes("/links")) return "links";
    if (path.includes("/url-inspection")) return "url-inspection";
    if (/\/search-console\/?$/.test(path)) return "overview";
    return "gsc-report";
  } catch {
    return "gsc-report";
  }
}

function formatLocalTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function buildGscReportFolderName(date) {
  return `${GSC_REPORT_DOWNLOAD_ROOT}/${formatLocalTimestamp(date)}`;
}

function decodeHtml(text) {
  const t = document.createElement("textarea");
  t.innerHTML = text || "";
  return t.value;
}

function escapeHtml(value) {
  return (value ?? "").toString().replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[m]));
}

function escapeMd(value) {
  return (value ?? "").toString().replace(/\|/g, "\\|");
}

function escapeTable(value) {
  return escapeMd(value).replace(/\n/g, " ").slice(0, 220);
}
