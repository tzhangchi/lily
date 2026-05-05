const GSC_STORAGE_KEYS = {
  submitJob: "lily_gsc_submit_job",
  reportJob: "lily_gsc_report_job"
};

const DEFAULT_PROPERTY = "sc-domain:llamagen.ai";
const DEFAULT_ALLOW_DOMAINS = ["llamagen.ai", "www.llamagen.ai"];
const DEFAULT_REPORT_URLS = [];
const DEFAULT_REPORT_FIELD_COUNT = 3;
const REPORT_URL_PLACEHOLDER = "留空则抓取当前已打开的 GSC 报告页";

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
      <div class="muted">
        自动辅助 Google Search Console URL Inspection 提交索引请求，并抓取核心报告 Markdown + 截图。
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
            <label class="small"><input id="gscIncludeDetails" type="checkbox" checked /> Include detail pages</label>
            <div class="row" style="margin-top:8px;">
              <input id="gscMaxDepth" class="input" style="max-width:120px;" type="number" min="0" max="3" value="2" />
              <input id="gscMaxPages" class="input" style="max-width:120px;" type="number" min="1" max="60" value="30" />
            </div>
            <div class="hint">请先在当前页签打开正确账号 / Property 的 GSC 报告。报告抓取只复用当前页签，默认下载到 Downloads/lily-gsc-reports/时间戳/。</div>
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
    return url;
  } catch {
    return url;
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
  const includeDetails = !!document.getElementById("gscIncludeDetails")?.checked;
  const maxDepth = clampInt(valueOf("gscMaxDepth"), 0, 3, 2);
  const maxPages = clampInt(valueOf("gscMaxPages"), 1, 60, 30);
  if (!activeTab?.id) return setReportStatus("没有可用的当前页签");
  if (!urls.length) return setReportStatus("请先在当前页签打开 GSC 报告页，或粘贴要在当前页签中抓取的报告 URL");
  if (!inputUrls.length && !isSearchConsoleUrl(currentUrl)) return setReportStatus("当前页签不是 GSC 报告页，请先打开正确的 Search Console 页面");

  const folder = `lily-gsc-reports/${formatLocalTimestamp(new Date())}`;
  const job = { type: "reports", urls, files: [], pages: [], status: "running", startedAt: new Date().toISOString(), folder, tabId: activeTab.id };
  await saveReportJob(job);

  const queue = urls.map((url) => ({ url, depth: 0, source: "entry" }));
  const seen = new Set();
  while (queue.length && job.pages.length < maxPages && !reportController.stopped) {
    const item = queue.shift();
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    setReportStatus(`抓取 ${job.pages.length + 1}/${maxPages}: ${item.url}`);

    const page = await captureSingleReportPage(activeTab.id, item.url, folder, job.pages.length + 1, item.depth, { cwvDrilldown, maxPages });
    job.pages.push(page);
    job.files.push(...(page.files || []));
    renderReportFiles(job.files);
    await saveReportJob(job);

    if (includeDetails && item.depth < maxDepth && page.detailUrls?.length) {
      for (const detailUrl of page.detailUrls) {
        const alignedDetailUrl = alignGoogleAccountPath(detailUrl, currentUrl);
        if (!seen.has(alignedDetailUrl) && queue.length + job.pages.length < maxPages) queue.push({ url: alignedDetailUrl, depth: item.depth + 1, source: item.url });
      }
    }
  }

  const indexMd = buildIndexMarkdown(job);
  const manifest = JSON.stringify(job, null, 2);
  const indexPath = `${folder}/index.md`;
  const manifestPath = `${folder}/manifest.json`;
  await downloadTextFile(indexPath, indexMd, "text/markdown;charset=utf-8");
  await downloadTextFile(manifestPath, manifest, "application/json;charset=utf-8");
  job.files.push(indexPath, manifestPath);
  job.status = reportController.stopped ? "stopped" : "done";
  job.finishedAt = new Date().toISOString();
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
    await runInTab(tabId, pageAutoScroll, []);
    await sleep(1200);

    const extracted = await runInTab(tabId, pageExtractReportMetrics, [DETAIL_TEXTS]);
    const title = extracted?.title || titleFallback;
    const actualUrl = extracted?.url || tab?.url || url;
    const slug = `${String(index).padStart(2, "0")}-${safeSlug(title)}`;
    const mdPath = `${folder}/${slug}.md`;
    const pngPath = `${folder}/${slug}.png`;
    const screenshotDataUrl = await captureVisibleTabForTab(tabId);
    const md = buildPageMarkdown({ url: actualUrl, title, depth, extracted, screenshot: pngPath });
    await downloadTextFile(mdPath, md, "text/markdown;charset=utf-8");
    await downloadDataUrlFile(pngPath, screenshotDataUrl);
    return { url: actualUrl, requestedUrl: url, title, status: "success", depth, files: [mdPath, pngPath], screenshot: pngPath, metrics: extracted?.metrics || [], detailUrls: extracted?.detailUrls || [] };
  } catch (e) {
    const title = titleFallback;
    const slug = `${String(index).padStart(2, "0")}-${safeSlug(title)}-failed`;
    const mdPath = `${folder}/${slug}.md`;
    const md = `# ${title}\n\nURL: ${url}\n\nStatus: failed\n\nError: ${e.message || String(e)}\n`;
    await downloadTextFile(mdPath, md, "text/markdown;charset=utf-8");
    return { url, title, status: "failed", depth, error: e.message || String(e), files: [mdPath], metrics: [], detailUrls: [] };
  }
}

async function captureCoreWebVitalsDrilldown(tabId, startUrl, folder, index, depth, options = {}) {
  const title = "Core Web Vitals Drilldown";
  const slugBase = `${String(index).padStart(2, "0")}-${safeSlug(title)}`;
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
    await downloadDataUrlFile(issueScreenshotPath, await captureVisibleTabForTab(tabId));
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

      const detailScreenshotPath = `${folder}/${slugBase}-${safeSlug(deviceName)}-${String(i + 1).padStart(2, "0")}-${safeSlug(issue.issue)}.png`;
      await downloadDataUrlFile(detailScreenshotPath, await captureVisibleTabForTab(tabId));
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
  const title = document.title || document.querySelector("h1")?.innerText || location.pathname;
  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .map((x) => x.innerText.trim())
    .filter(Boolean)
    .slice(0, 30);

  const metricNodes = Array.from(document.querySelectorAll('[role="heading"], h1, h2, h3, h4, [aria-label], div, span'))
    .map((el) => (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
    .filter((x) => x && x.length <= 160 && /\d|good|poor|needs improvement|indexed|not indexed|valid|invalid|错误|有效|已编入|未编入|较差|良好|需要改进/i.test(x));
  const metrics = Array.from(new Set(metricNodes)).slice(0, 80);

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = (detailTexts || []).map(norm);
  const links = Array.from(document.querySelectorAll("a, button, [role='button']"));
  const detailUrls = [];
  for (const el of links) {
    const label = norm(el.innerText || el.textContent || el.getAttribute("aria-label"));
    if (!wanted.some((w) => label.includes(w))) continue;
    const href = el.href || el.closest("a")?.href || "";
    if (href && href.startsWith("https://search.google.com/")) detailUrls.push(href);
  }

  return { title, url: location.href, headings, metrics, textSnapshot: text.slice(0, 5000), detailUrls: Array.from(new Set(detailUrls)).slice(0, 12) };
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
  return {
    ok: rows.length > 0,
    url: location.href,
    title,
    issue,
    headers,
    metricColumn: metricIndex >= 0 ? headers[metricIndex] : "",
    rows
  };
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
  return `# ${page.title}\n\nURL: ${page.url}\n\nDepth: ${page.depth}\n\nScreenshot: ./${page.screenshot.split("/").pop()}\n\n## Key metrics\n\n${metrics.map((x) => `- ${x}`).join("\n") || "- No metrics extracted"}\n\n## Headings\n\n${headings.map((x) => `- ${x}`).join("\n") || "- No headings extracted"}\n\n## Text snapshot\n\n\`\`\`text\n${(extracted.textSnapshot || "").slice(0, 4000)}\n\`\`\`\n`;
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

function buildIndexMarkdown(job) {
  const rows = (job.pages || []).map((p) => `| ${escapeTable(p.title)} | ${p.status} | ${escapeTable((p.metrics || []).slice(0, 3).join("; "))} | ${p.screenshot || ""} |`).join("\n");
  const followups = [];
  for (const p of job.pages || []) {
    const joined = (p.metrics || []).join(" ").toLowerCase();
    if (/not indexed|未编入|poor|较差|invalid|错误|needs improvement|需要改进/.test(joined)) followups.push(`Review ${p.title}: ${p.url}`);
  }
  return `# GSC Report\n\nGenerated at: ${new Date().toLocaleString()}\n\nFolder: ${job.folder}\n\n## Summary\n\n| Report | Status | Key Findings | Screenshot |\n|---|---|---|---|\n${rows || "| - | - | - | - |"}\n\n## Follow-up Items\n\n${followups.map((x, i) => `${i + 1}. ${x}`).join("\n") || "No obvious follow-up items extracted."}\n\n## Source URLs\n\n${(job.urls || []).map((u) => `- ${u}`).join("\n")}\n`;
}

async function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const url = `data:${mimeType},${encodeURIComponent(content)}`;
  return chrome.downloads.download({ url, filename, saveAs: false });
}

async function downloadDataUrlFile(filename, dataUrl) {
  return chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
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
  return `${job.status || "running"}: pages ${(job.pages || []).length}, files ${(job.files || []).length}, folder ${job.folder || ""}`;
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

function formatLocalTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
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
