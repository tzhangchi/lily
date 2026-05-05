const GSC_STORAGE_KEYS = {
  submitJob: "lily_gsc_submit_job",
  reportJob: "lily_gsc_report_job"
};

const DEFAULT_PROPERTY = "sc-domain:llamagen.ai";
const DEFAULT_ALLOW_DOMAINS = ["llamagen.ai", "www.llamagen.ai"];
const DEFAULT_REPORT_URLS = [
  "https://search.google.com/u/2/search-console/index?resource_id=sc-domain%3Allamagen.ai",
  "https://search.google.com/u/2/search-console/core-web-vitals?resource_id=sc-domain%3Allamagen.ai",
  "https://search.google.com/u/2/search-console/performance/insights?resource_id=sc-domain%3Allamagen.ai"
];

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
            <textarea id="gscReportUrls" class="input" style="min-height:92px;">${DEFAULT_REPORT_URLS.join("\n")}</textarea>
          </div>
        </label>
        <label class="kv">
          <div class="k">Options</div>
          <div class="v">
            <label class="small"><input id="gscIncludeDetails" type="checkbox" checked /> Include detail pages</label>
            <div class="row" style="margin-top:8px;">
              <input id="gscMaxDepth" class="input" style="max-width:120px;" type="number" min="0" max="3" value="2" />
              <input id="gscMaxPages" class="input" style="max-width:120px;" type="number" min="1" max="60" value="30" />
            </div>
            <div class="hint">默认下载到 Downloads/lily-gsc-reports/时间戳/。Chrome 插件不能静默写入 Desktop 任意目录。</div>
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
  on("gscStartReports", "click", runReportCaptureJob);
  on("gscStopReports", "click", () => {
    reportController.stopped = true;
    setReportStatus("正在停止…");
  });
}

function on(id, event, handler) {
  document.getElementById(id)?.addEventListener(event, handler);
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
  const urls = uniqueUrls(valueOf("gscReportUrls").split(/\n+/).map(normalizeUrl).filter(Boolean));
  const includeDetails = !!document.getElementById("gscIncludeDetails")?.checked;
  const maxDepth = clampInt(valueOf("gscMaxDepth"), 0, 3, 2);
  const maxPages = clampInt(valueOf("gscMaxPages"), 1, 60, 30);
  if (!urls.length) return setReportStatus("没有报告 URL");

  const folder = `lily-gsc-reports/${formatLocalTimestamp(new Date())}`;
  const job = { type: "reports", urls, files: [], pages: [], status: "running", startedAt: new Date().toISOString(), folder };
  await saveReportJob(job);

  const queue = urls.map((url) => ({ url, depth: 0, source: "entry" }));
  const seen = new Set();
  while (queue.length && job.pages.length < maxPages && !reportController.stopped) {
    const item = queue.shift();
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    setReportStatus(`抓取 ${job.pages.length + 1}/${maxPages}: ${item.url}`);

    const page = await captureSingleReportPage(item.url, folder, job.pages.length + 1, item.depth);
    job.pages.push(page);
    job.files.push(...(page.files || []));
    renderReportFiles(job.files);
    await saveReportJob(job);

    if (includeDetails && item.depth < maxDepth && page.detailUrls?.length) {
      for (const detailUrl of page.detailUrls) {
        if (!seen.has(detailUrl) && queue.length + job.pages.length < maxPages) queue.push({ url: detailUrl, depth: item.depth + 1, source: item.url });
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

async function captureSingleReportPage(url, folder, index, depth) {
  let tab;
  const titleFallback = `report-${index}`;
  try {
    tab = await chrome.tabs.create({ url, active: true });
    await sleep(8000);
    await runInTab(tab.id, pageAutoScroll, []);
    await sleep(1200);

    const extracted = await runInTab(tab.id, pageExtractReportMetrics, [DETAIL_TEXTS]);
    const title = extracted?.title || titleFallback;
    const slug = `${String(index).padStart(2, "0")}-${safeSlug(title)}`;
    const mdPath = `${folder}/${slug}.md`;
    const pngPath = `${folder}/${slug}.png`;
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" });
    const md = buildPageMarkdown({ url, title, depth, extracted, screenshot: pngPath });
    await downloadTextFile(mdPath, md, "text/markdown;charset=utf-8");
    await downloadDataUrlFile(pngPath, screenshotDataUrl);
    return { url, title, status: "success", depth, files: [mdPath, pngPath], screenshot: pngPath, metrics: extracted?.metrics || [], detailUrls: extracted?.detailUrls || [] };
  } catch (e) {
    const title = titleFallback;
    const slug = `${String(index).padStart(2, "0")}-${safeSlug(title)}-failed`;
    const mdPath = `${folder}/${slug}.md`;
    const md = `# ${title}\n\nURL: ${url}\n\nStatus: failed\n\nError: ${e.message || String(e)}\n`;
    await downloadTextFile(mdPath, md, "text/markdown;charset=utf-8");
    return { url, title, status: "failed", depth, error: e.message || String(e), files: [mdPath], metrics: [], detailUrls: [] };
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }
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
