import { DEFAULT_SETTINGS } from "../shared/constants.js";
import { escapeCsvValue, safeLower } from "../shared/utils.js";

const els = {
  favicon: document.getElementById("favicon"),
  pageTitle: document.getElementById("pageTitle"),
  pageMeta: document.getElementById("pageMeta"),
  scorePill: document.getElementById("scorePill"),
  chips: document.getElementById("chips"),
  btnAnalyze: document.getElementById("btnAnalyze"),
  toggleHighlight: document.getElementById("toggleHighlight"),
  btnCopySummary: document.getElementById("btnCopySummary"),
  btnExportMarkdown: document.getElementById("btnExportMarkdown"),
  btnExportCsv: document.getElementById("btnExportCsv"),
  secOverview: document.getElementById("sec-overview"),
  secLinks: document.getElementById("sec-links"),
  secInsights: document.getElementById("sec-insights"),
  secSeo: document.getElementById("sec-seo"),
  secSave: document.getElementById("sec-save")
};

let settings = { ...DEFAULT_SETTINGS };
let analysis = null;
let linksFilter = {
  scope: "content", // all | content
  showCompetitor: false,
  showAffiliate: false,
  showSponsor: false,
  showNofollow: false,
  category: "all",
  q: "",
  hideNoise: true
};

init();

async function init() {
  wireActions();
  wireSideNav();
  const res = await chrome.runtime.sendMessage({ type: "LR_GET_SETTINGS" });
  if (res?.ok) settings = res.settings;
  linksFilter.scope = settings.defaultScope || "content";
  linksFilter.hideNoise = settings.hideNoiseByDefault ?? true;
  els.toggleHighlight.checked = settings.highlightEnabled ?? false;
  renderEmpty();

  // 交互优化：打开插件弹窗时，默认自动触发一次分析（失败不影响手动 Analyze 重试）
  // 注意：Chrome 限制页面（如 Chrome Web Store / 设置页）会返回错误提示
  runAnalyze();
}

function wireActions() {
  els.btnAnalyze.addEventListener("click", async () => {
    await runAnalyze();
  });

  els.toggleHighlight.addEventListener("change", async (e) => {
    settings.highlightEnabled = !!e.target.checked;
    await chrome.runtime.sendMessage({ type: "LR_TOGGLE_HIGHLIGHT", enabled: settings.highlightEnabled, settings });
    await chrome.runtime.sendMessage({ type: "LR_SET_SETTINGS", settings });
  });

  els.btnCopySummary.addEventListener("click", async () => {
    if (!analysis?.summary) return;
    await navigator.clipboard.writeText(analysis.summary);
    toast("已复制 Summary");
  });

  els.btnExportMarkdown.addEventListener("click", async () => {
    if (!analysis) return toast("请先分析页面");
    toast(settings.aiEnabled ? "AI 正在整理 Markdown…" : "正在导出 Markdown…");
    const res = await chrome.runtime.sendMessage({ type: "LR_EXPORT_MARKDOWN", analysis });
    if (!res?.ok) toast(res?.error || "导出失败");
    else toast(res.aiUsed ? "已导出 AI Markdown" : "已导出 Markdown");
  });

  els.btnExportCsv.addEventListener("click", async () => {
    // 仅导出“已保存”的库（V1）
    const res = await chrome.runtime.sendMessage({ type: "LR_EXPORT_CSV" });
    if (!res?.ok) toast(res?.error || "导出失败");
  });
}

function wireSideNav() {
  const navItems = Array.from(document.querySelectorAll("[data-jump]"));
  const setActive = (btn) => {
    navItems.forEach((x) => x.classList.remove("nav-item-active"));
    btn.classList.add("nav-item-active");
  };
  navItems.forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-jump");
      const el = id ? document.getElementById(id) : null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(btn);
    })
  );
}

async function runAnalyze() {
  setBusy(true);
  try {
    const res = await chrome.runtime.sendMessage({ type: "LR_ANALYZE_ACTIVE_TAB" });
    if (!res?.ok) throw new Error(res?.error || "分析失败");
    analysis = res.analysis;

    // favicon
    try {
      const u = new URL(analysis.url);
      els.favicon.src = `${u.origin}/favicon.ico`;
    } catch {}

    els.pageTitle.textContent = analysis.title || "（无标题）";
    els.pageMeta.textContent = `${analysis.domain}  |  ${analysis.pageType}`;
    renderScore(analysis.score);
    renderChips();
    renderAll();
  } catch (e) {
    const msg = e?.message || String(e);
    // 交互优化：刚打开 popup 时，content script 可能尚未注入（页面未刷新/刚装扩展/刚跳转）
    if (/未就绪|未注入|Receiving end does not exist|Could not establish connection/i.test(msg) && !runAnalyze._retried) {
      runAnalyze._retried = true;
      await new Promise((r) => setTimeout(r, 900));
      return runAnalyze();
    }
    runAnalyze._retried = false;
    renderError(msg);
  } finally {
    setBusy(false);
  }
}

function setBusy(b) {
  els.btnAnalyze.disabled = b;
  els.btnAnalyze.textContent = b ? "分析中…" : "分析页面";
}

function renderScore(score) {
  els.scorePill.textContent = typeof score === "number" ? String(score) : "--";
  els.scorePill.className = "pill " + scoreClass(score);
}

function scoreClass(score) {
  if (typeof score !== "number") return "pill-gray";
  if (score >= 90) return "pill-green";
  if (score >= 70) return "pill-blue";
  if (score >= 50) return "pill-orange";
  return "pill-gray";
}

function renderChips() {
  els.chips.innerHTML = "";
  if (!analysis) return;
  const chips = [];
  chips.push({ text: `外链 ${analysis.totalLinks}` });
  chips.push({ text: `正文 ${analysis.contentLinks}`, strong: true });
  if ((analysis.competitorMentions || []).length) chips.push({ text: `竞品 ${analysis.competitorMentions.length}`, strong: true });
  if ((analysis.commercialSignals || []).length) chips.push({ text: `商业痕迹`, strong: true });
  for (const c of chips) {
    const el = document.createElement("span");
    el.className = "chip" + (c.strong ? " chip-strong" : "");
    el.textContent = c.text;
    els.chips.appendChild(el);
  }
}

function renderAll() {
  // 默认展示所有内容：从上往下渲染各个区域（不再用 tab 切换）
  renderOverview();
  renderLinks();
  renderInsights();
  renderSeo();
  renderSave();
}

function renderEmpty() {
  els.secOverview.innerHTML = `
    <div class="card">
      <h3>开始使用</h3>
      <div class="muted">打开任意页面后点击右上角 <b>Analyze</b>，即可得到外链/竞品/商业痕迹与机会评分。</div>
      <div class="muted" style="margin-top:8px;">提示：首次使用时请允许访问当前页面。</div>
    </div>
  `;
  els.secLinks.innerHTML = `<div class="card"><div class="muted">请先 Analyze。</div></div>`;
  els.secInsights.innerHTML = `<div class="card"><div class="muted">请先 Analyze。</div></div>`;
  els.secSeo.innerHTML = `<div class="card"><div class="muted">请先 Analyze。</div></div>`;
  els.secSave.innerHTML = `<div class="card"><div class="muted">请先 Analyze。</div></div>`;
}

function renderError(msg) {
  els.secOverview.innerHTML = `
    <div class="card">
      <h3>无法分析</h3>
      <div class="muted error">${escapeHtml(msg)}</div>
      <div class="muted" style="margin-top:10px;">
        可能原因：
        <ul style="margin:6px 0 0 18px; padding:0;">
          <li>Chrome 限制页面（Chrome Web Store、设置页等）——内容脚本无法运行</li>
          <li>普通网页但提示 “Receiving end does not exist / Could not establish connection” ——通常是内容脚本未注入：请刷新页面（Cmd/Ctrl+R）后再点插件</li>
        </ul>
      </div>
    </div>
  `;
  // 其余区域保持占位，避免空白
  els.secLinks.innerHTML = `<div class="card"><div class="muted">—</div></div>`;
  els.secInsights.innerHTML = `<div class="card"><div class="muted">—</div></div>`;
  els.secSeo.innerHTML = `<div class="card"><div class="muted">—</div></div>`;
  els.secSave.innerHTML = `<div class="card"><div class="muted">—</div></div>`;
}

function renderOverview() {
  if (!analysis) return renderEmpty();
  const nextAction = suggestNextAction(analysis);
  const topProducts = (analysis.links || []).slice(0, 5);
  const ai = analysis.ai || null;

  els.secOverview.innerHTML = `
    <div class="card">
      <h3>一句话总结</h3>
      <div>${escapeHtml(ai?.summary || analysis.summary || "")}</div>
    </div>

    ${
      ai?.conversionChecklist?.length
        ? `
      <div class="card">
        <h3>转化页要素（AI Checklist）</h3>
        ${renderBullets(ai.conversionChecklist)}
      </div>
    `
        : ""
    }

    <div class="card">
      <h3>关键指标</h3>
      <div class="metrics">
        ${metric("外链总数", analysis.totalLinks)}
        ${metric("正文外链", analysis.contentLinks)}
        ${metric("竞品命中", (analysis.competitorMentions || []).length)}
        ${metric("商业痕迹", (analysis.commercialSignals || []).length ? "有" : "无")}
      </div>
    </div>

    <div class="card">
      <h3>下一步建议</h3>
      <div><span class="badge badge-blue">${escapeHtml(nextAction.primary)}</span></div>
      <div class="muted" style="margin-top:6px;">${escapeHtml(nextAction.reason)}</div>
    </div>

    <div class="card">
      <h3>Top Links（按优先级）</h3>
      <div class="small">优先展示：正文 / 竞品 / affiliate / 产品官网</div>
      <div style="margin-top:8px;">
        ${topProducts.map(renderMiniLink).join("") || "<div class='muted'>无</div>"}
      </div>
    </div>
  `;
}

function metric(k, v) {
  return `
    <div class="metric">
      <div class="k">${escapeHtml(k)}</div>
      <div class="v">${escapeHtml(String(v ?? "--"))}</div>
    </div>
  `;
}

function renderMiniLink(l) {
  return `
    <div style="padding:8px 0; border-top:1px solid rgba(255,255,255,0.06);">
      <div class="link-domain">${escapeHtml(l.domain)}</div>
      <div class="small">${escapeHtml(l.anchorText || "(no anchor)")}</div>
      <div style="margin-top:4px; display:flex; gap:6px; flex-wrap:wrap;">
        <span class="badge badge-gray">${escapeHtml(l.location)}</span>
        <span class="badge badge-gray">${escapeHtml(l.category)}</span>
        ${l.isCompetitor ? `<span class="badge badge-orange">competitor</span>` : ""}
        ${l.isSponsored ? `<span class="badge badge-orange">sponsored</span>` : ""}
        ${l.isNofollow ? `<span class="badge badge-gray">nofollow</span>` : ""}
      </div>
    </div>
  `;
}

function renderLinks() {
  if (!analysis) return renderEmpty();

  const filtered = (analysis.links || []).filter((l) => passesFilter(l));
  const allPageLinks = analysis.allPageLinks || [];
  const previewLinks = allPageLinks.slice(0, 120);

  els.secLinks.innerHTML = `
    <div class="card">
      <h3>筛选</h3>
      <div class="row">
        ${segmented("scope", [
          { k: "all", label: "全部" },
          { k: "content", label: "正文" }
        ])}
        ${toggle("hideNoise", "隐藏噪音")}
        ${toggle("showCompetitor", "竞品")}
        ${toggle("showAffiliate", "affiliate")}
        ${toggle("showSponsor", "sponsor")}
        ${toggle("showNofollow", "nofollow")}
      </div>
      <div class="row" style="margin-top:8px;">
        <select id="selCategory" class="select" style="flex:1;">
          ${["all","product","blog","social","affiliate","ad","doc","download","login","register","other"].map((c)=>`<option value="${c}">${c}</option>`).join("")}
        </select>
        <input id="inpSearch" class="input" style="flex:2;" placeholder="按域名/锚文本/URL 搜索" />
      </div>
      <div class="muted" style="margin-top:8px;">当前：${filtered.length} / ${(analysis.links||[]).length} 条</div>
    </div>

    <div class="card">
      <h3>外链列表</h3>
      ${renderLinksAccordion(filtered)}
    </div>

    <div class="card">
      <h3>网页所有超链接</h3>
      <div class="row" style="justify-content:space-between;">
        <div class="muted">当前页面共检测到 ${escapeHtml(String(allPageLinks.length))} 个唯一超链接（含站内/站外/mailto/tel）。</div>
        <div class="row">
          <button id="btnCopyAllHyperlinks" class="btn btn-primary">复制全部链接</button>
        </div>
      </div>
      <div style="margin-top:10px;">
        ${renderAllPageLinksAccordion(previewLinks)}
      </div>
      ${allPageLinks.length > previewLinks.length ? `<div class="muted" style="margin-top:8px;">为避免面板太重，当前仅预览前 ${previewLinks.length} 条；“复制全部链接”会复制全部。</div>` : ""}
    </div>
  `;

  const sel = document.getElementById("selCategory");
  const inp = document.getElementById("inpSearch");
  sel.value = linksFilter.category;
  inp.value = linksFilter.q;
  sel.addEventListener("change", () => {
    linksFilter.category = sel.value;
    renderLinks();
  });
  inp.addEventListener("input", () => {
    linksFilter.q = inp.value;
    renderLinks();
  });

  wireFilterButtons();
  wireAccordion();
  wireAllHyperlinksActions(allPageLinks);
}

function segmented(key, items) {
  return `
    <div class="row">
      ${items
        .map((it) => {
          const active = linksFilter[key] === it.k;
          return `<button class="btn ${active ? "btn-primary" : ""}" data-filter="${key}" data-value="${it.k}">${it.label}</button>`;
        })
        .join("")}
    </div>
  `;
}

function toggle(key, label) {
  const active = !!linksFilter[key];
  return `<button class="btn ${active ? "btn-primary" : ""}" data-filter="${key}" data-value="${active ? "0" : "1"}">${label}</button>`;
}

function wireFilterButtons() {
  for (const b of Array.from(document.querySelectorAll("[data-filter]"))) {
    b.addEventListener("click", () => {
      const k = b.getAttribute("data-filter");
      const v = b.getAttribute("data-value");
      if (k === "scope") linksFilter.scope = v;
      else linksFilter[k] = v === "1";
      renderLinks();
    });
  }
}

function passesFilter(l) {
  if (linksFilter.scope === "content" && l.location !== "content") return false;
  if (linksFilter.hideNoise && (l.location === "nav" || l.location === "footer")) return false;
  if (linksFilter.showCompetitor && !l.isCompetitor) return false;
  if (linksFilter.showAffiliate && l.category !== "affiliate") return false;
  if (linksFilter.showSponsor && !l.isSponsored) return false;
  if (linksFilter.showNofollow && !l.isNofollow) return false;
  if (linksFilter.category !== "all" && l.category !== linksFilter.category) return false;
  const q = safeLower(linksFilter.q);
  if (q) {
    const h = safeLower(`${l.domain} ${l.anchorText} ${l.url}`);
    if (!h.includes(q)) return false;
  }
  return true;
}

function renderLinksAccordion(list) {
  if (!list.length) return `<div class="muted">无匹配结果。</div>`;
  return `
    <div class="accordion">
      ${list
        .map(
          (l, idx) => `
        <div class="acc-item" data-acc="${idx}">
          <div class="acc-head">
            <div style="min-width:0;">
              <div class="link-domain">${escapeHtml(l.domain)}</div>
              <div class="small">${escapeHtml(l.anchorText || "(no anchor)")}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:flex-start; flex-wrap:wrap; justify-content:flex-end;">
              <span class="badge badge-gray">${escapeHtml(l.location)}</span>
              <span class="badge badge-gray">${escapeHtml(l.category)}</span>
              ${l.isCompetitor ? `<span class="badge badge-orange">competitor</span>` : ""}
            </div>
          </div>
          <div class="acc-body">
            <div class="small">${escapeHtml(l.url)}</div>
            ${l.contextText ? `<div style="margin-top:8px;">${escapeHtml(l.contextText)}</div>` : ""}
            <div class="row" style="margin-top:10px; justify-content:space-between;">
              <div class="small">出现次数：${l.occurrenceCount}</div>
              <div class="row">
                <button class="btn btn-ghost" data-open="${escapeHtmlAttr(l.url)}">Open</button>
                <button class="btn btn-ghost" data-copy="${escapeHtmlAttr(l.url)}">Copy</button>
              </div>
            </div>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function wireAccordion() {
  for (const head of Array.from(document.querySelectorAll(".acc-head"))) {
    head.addEventListener("click", () => {
      head.parentElement.classList.toggle("open");
    });
  }
  for (const btn of Array.from(document.querySelectorAll("[data-open]"))) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: btn.getAttribute("data-open") });
    });
  }
  for (const btn of Array.from(document.querySelectorAll("[data-copy]"))) {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(btn.getAttribute("data-copy"));
      toast("已复制链接");
    });
  }
}

function renderAllPageLinksAccordion(list) {
  if (!list.length) return `<div class="muted">未检测到超链接。</div>`;
  return `
    <div class="accordion">
      ${list
        .map(
          (l, idx) => `
        <div class="acc-item" data-all-link="${idx}">
          <div class="acc-head">
            <div style="min-width:0;">
              <div class="link-domain">${escapeHtml(l.anchorText || l.title || l.ariaLabel || "(no anchor text)")}</div>
              <div class="small">${escapeHtml(l.href || l.rawHref || "")}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:flex-start; flex-wrap:wrap; justify-content:flex-end;">
              <span class="badge badge-gray">${escapeHtml(l.location || "page")}</span>
              <span class="badge badge-gray">${escapeHtml(l.protocol || "link")}</span>
              ${l.sameDomain ? `<span class="badge badge-gray">internal</span>` : ""}
              ${l.isExternal ? `<span class="badge badge-orange">external</span>` : ""}
            </div>
          </div>
          <div class="acc-body">
            <div class="small">${escapeHtml(l.href || l.rawHref || "")}</div>
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
              ${l.domain ? `<span class="badge badge-gray">${escapeHtml(l.domain)}</span>` : ""}
              ${l.title ? `<span class="badge badge-gray">title: ${escapeHtml(l.title)}</span>` : ""}
              ${l.ariaLabel ? `<span class="badge badge-gray">aria: ${escapeHtml(l.ariaLabel)}</span>` : ""}
            </div>
            <div class="row" style="margin-top:10px; justify-content:flex-end;">
              <button class="btn btn-ghost" data-open-hyperlink="${escapeHtmlAttr(l.href || l.rawHref || "")}">Open</button>
              <button class="btn btn-ghost" data-copy-hyperlink="${escapeHtmlAttr(l.href || l.rawHref || "")}">Copy</button>
            </div>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function wireAllHyperlinksActions(allPageLinks) {
  const copyAllBtn = document.getElementById("btnCopyAllHyperlinks");
  copyAllBtn?.addEventListener("click", async () => {
    const text = allPageLinks.map((x) => x.href || x.rawHref || "").filter(Boolean).join("\n");
    if (!text) return toast("没有可复制的链接");
    await navigator.clipboard.writeText(text);
    toast(`已复制 ${allPageLinks.length} 条链接`);
  });

  for (const btn of Array.from(document.querySelectorAll("[data-open-hyperlink]"))) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = btn.getAttribute("data-open-hyperlink");
      if (!url) return;
      chrome.tabs.create({ url });
    });
  }
  for (const btn of Array.from(document.querySelectorAll("[data-copy-hyperlink]"))) {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const url = btn.getAttribute("data-copy-hyperlink");
      if (!url) return;
      await navigator.clipboard.writeText(url);
      toast("已复制链接");
    });
  }
}

function renderInsights() {
  if (!analysis) return renderEmpty();
  const ai = analysis.ai || null;
  els.secInsights.innerHTML = `
    <div class="card">
      <h3>洞察（3-5 条）</h3>
      ${renderBullets(analysis.insights || [])}
    </div>
    ${
      ai?.insights?.length
        ? `
      <div class="card">
        <h3>洞察（AI）</h3>
        ${renderBullets(ai.insights)}
      </div>
    `
        : ""
    }
    <div class="card">
      <h3>证据</h3>
      <div class="muted">页面类型：<b>${escapeHtml(analysis.pageType)}</b></div>
      <div class="muted" style="margin-top:6px;">商业信号：${escapeHtml((analysis.commercialSignals||[]).join("、") || "无")}</div>
      <div class="muted" style="margin-top:6px;">竞品域名：${escapeHtml((analysis.competitorMentions||[]).slice(0,8).join("、") || "无")}</div>
    </div>
  `;
}

function renderSeo() {
  if (!analysis) return renderEmpty();
  const seo = analysis.seo || {};
  const pageBrief = analysis.pageBrief || {};
  const issues = seo.issues || [];
  const kws = seo.keywordDensity?.top || [];
  const serp = seo.serp || {};
  const social = seo.social || {};
  const ai = analysis.ai || null;

  const levelBadge = (lvl) => {
    if (lvl === "error") return `<span class="badge badge-red">error</span>`;
    if (lvl === "warn") return `<span class="badge badge-orange">warn</span>`;
    return `<span class="badge badge-gray">info</span>`;
  };

  const kvRow = (k, v, hint = "") => `
    <div class="kv">
      <div class="k">${escapeHtml(k)}</div>
      <div class="v">
        <div>${escapeHtml(v || "--")}</div>
        ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ""}
      </div>
    </div>
  `;

  els.secSeo.innerHTML = `
    <div class="card">
      <h3>基础信息</h3>
      <div class="kv-list">
        ${kvRow("Title", seo.title, "建议 30-60 字符")}
        ${kvRow("Description", seo.description, "建议 70-160 字符")}
        ${kvRow("单词数量", String(seo.wordCount ?? "--"), "英文单词数（粗略）")}
        ${kvRow("中文字符数", String(seo.zhCharCount ?? "--"), "中文按汉字计数（粗略）")}
        ${kvRow("Canonical", seo.canonical || "", seo.canonicals?.length > 1 ? `重复 ${seo.canonicals.length} 个` : "")}
        ${kvRow("H1", (seo.h1 || []).join(" / "), "建议只保留 1 个，围绕主关键词")}
      </div>
    </div>

    <div class="card">
      <h3>落地页转化元素</h3>
      <div class="metrics">
        ${metric("折扣/Offer", (pageBrief.discountBanners || []).length)}
        ${metric("免费/CTA", (pageBrief.freeButtons || pageBrief.ctas || []).length)}
        ${metric("页面切换", (pageBrief.pageSwitches || []).length)}
        ${metric("案例/效果", (pageBrief.examples || []).length)}
      </div>
      <div style="margin-top:12px;">
        ${renderSignalBlock("顶部折扣", pageBrief.discountBanners)}
        ${renderSignalBlock("免费按钮 / CTA", (pageBrief.freeButtons || []).length ? pageBrief.freeButtons : pageBrief.ctas)}
        ${renderSignalBlock("页面切换 / Tabs", pageBrief.pageSwitches)}
        ${renderSignalBlock("默认模型", pageBrief.defaultModels)}
        ${renderSignalBlock("效果好的案例", pageBrief.examples)}
        ${renderSignalBlock("生成记录 Tab", pageBrief.generationHistory)}
      </div>
    </div>

    <div class="card">
      <h3>侧边栏与功能密度</h3>
      ${renderSidebars(pageBrief.sidebarFeatures || [])}
    </div>

    <div class="card">
      <h3>Issues（建议按优先级修复）</h3>
      ${issues.length ? `
        <div class="issue-list">
          ${issues
            .map((it) => `<div class="issue">${levelBadge(it.level)}<div class="issue-text">${escapeHtml(it.text)}</div></div>`)
            .join("")}
        </div>
      ` : `<div class="muted">未发现明显问题。</div>`}
    </div>

    <div class="card">
      <h3>关键词密度（Top）</h3>
      <div class="muted">粗略统计：总 token ${escapeHtml(String(seo.tokenCount ?? "--"))}。排名靠前的词可作为“候选主关键词”。</div>
      <div style="margin-top:10px;">
        ${kws.length ? `
          <table class="table">
            <thead>
              <tr><th>关键词</th><th>次数</th><th>密度</th></tr>
            </thead>
            <tbody>
              ${kws
                .map((k) => `<tr><td>${escapeHtml(k.term)}</td><td>${escapeHtml(String(k.count))}</td><td>${escapeHtml((k.density * 100).toFixed(2))}%</td></tr>`)
                .join("")}
            </tbody>
          </table>
        ` : `<div class="muted">无（页面文本可能很少或被限制读取）。</div>`}
      </div>
    </div>

    <div class="card">
      <h3>SERP 预览</h3>
      <div class="serp">
        <div class="serp-title">${escapeHtml(serp.title || seo.title || "")}</div>
        <div class="serp-url">${escapeHtml(serp.displayUrl || "")}</div>
        <div class="serp-desc">${escapeHtml(serp.description || seo.description || "")}</div>
      </div>
      <div class="row" style="margin-top:10px;">
        ${(serp.searchLinks || [])
          .map((l, idx) => `<button class="btn btn-ghost" data-seo-open="${escapeHtmlAttr(l.url)}">${escapeHtml(idx === 0 ? "查布局/示例" : "Google")}</button>`)
          .join("")}
        ${
          (ai?.serpQueries || []).length
            ? (ai.serpQueries || [])
                .slice(0, 4)
                .map((q) => {
                  const label = `AI: ${(q || "").toString().slice(0, 12)}${(q || "").length > 12 ? "…" : ""}`;
                  return `<button class="btn btn-ghost" data-seo-open="${escapeHtmlAttr(
                    `https://www.google.com/search?q=${encodeURIComponent(q)}`
                  )}">${escapeHtml(label)}</button>`;
                })
                .join("")
            : ""
        }
      </div>
      <div class="muted" style="margin-top:6px;">提示：带着好奇心去搜“落地页布局/竞品/alternatives”，观察别人怎么写 H1、结构、CTA、FAQ。</div>
    </div>

    <div class="card">
      <h3>Social（Open Graph / Twitter）</h3>
      <div class="kv-list">
        ${kvRow("og:title", social.og?.["og:title"] || "")}
        ${kvRow("og:description", social.og?.["og:description"] || "")}
        ${kvRow("og:image", social.og?.["og:image"] || "")}
        ${kvRow("twitter:card", social.twitter?.["twitter:card"] || "")}
        ${kvRow("twitter:title", social.twitter?.["twitter:title"] || "")}
        ${kvRow("twitter:description", social.twitter?.["twitter:description"] || "")}
      </div>
    </div>

    <div class="card">
      <h3>Markdown 页面复刻</h3>
      <div class="muted">导出会包含 SEO、SERP、关键词密度、转化元素、视觉风格、图片和页面 HTML 层级。启用 AI 后会先整理成高质量复刻 brief，失败则回退本地版本。</div>
      <div class="row" style="margin-top:10px;">
        <button id="btnCopyMarkdown" class="btn btn-primary">Copy AI Markdown</button>
        <button id="btnDownloadMarkdown" class="btn btn-ghost">Export AI Markdown</button>
      </div>
    </div>
  `;

  for (const btn of Array.from(document.querySelectorAll("[data-seo-open]"))) {
    btn.addEventListener("click", () => chrome.tabs.create({ url: btn.getAttribute("data-seo-open") }));
  }
  document.getElementById("btnCopyMarkdown")?.addEventListener("click", async () => {
    if (!analysis) return toast("请先分析页面");
    toast(settings.aiEnabled ? "AI 正在整理 Markdown…" : "正在生成 Markdown…");
    const res = await chrome.runtime.sendMessage({ type: "LR_BUILD_MARKDOWN", analysis });
    if (!res?.ok || !res.markdown) return toast(res?.error || "暂无 Markdown");
    await navigator.clipboard.writeText(res.markdown);
    toast(res.aiUsed ? "已复制 AI Markdown" : "已复制 Markdown");
  });
  document.getElementById("btnDownloadMarkdown")?.addEventListener("click", async () => {
    if (!analysis) return toast("请先分析页面");
    toast(settings.aiEnabled ? "AI 正在整理 Markdown…" : "正在导出 Markdown…");
    const res = await chrome.runtime.sendMessage({ type: "LR_EXPORT_MARKDOWN", analysis });
    if (!res?.ok) toast(res?.error || "导出失败");
    else toast(res.aiUsed ? "已导出 AI Markdown" : "已导出 Markdown");
  });
}

function renderSignalBlock(title, items = []) {
  const list = (items || []).slice(0, 6);
  return `
    <div class="signal-block">
      <div class="signal-title">${escapeHtml(title)}</div>
      ${
        list.length
          ? list.map((item) => `<div class="signal-item"><span class="badge badge-gray">${escapeHtml(item.location || item.tag || "page")}</span><span>${escapeHtml(item.text || item.label || item.hint || "")}</span></div>`).join("")
          : `<div class="muted">未检测到</div>`
      }
    </div>
  `;
}

function renderSidebars(sidebars = []) {
  if (!sidebars.length) return `<div class="muted">未检测到侧边栏功能列表。</div>`;
  return sidebars
    .slice(0, 4)
    .map(
      (sidebar) => `
        <div class="signal-block">
          <div class="signal-title">${escapeHtml(sidebar.title || "Sidebar")}</div>
          ${(sidebar.items || []).slice(0, 12).map((item) => `<div class="signal-item"><span>${escapeHtml(item)}</span></div>`).join("") || `<div class="muted">无可读条目</div>`}
        </div>
      `
    )
    .join("");
}

function renderSave() {
  if (!analysis) return renderEmpty();
  els.secSave.innerHTML = `
    <div class="card">
      <h3>保存到本地库</h3>
      <div class="row">
        <select id="selStatus" class="select">
          ${["未处理","已分析","待联系","已联系","已合作","已拒绝","无价值"].map((s)=>`<option value="${s}">${s}</option>`).join("")}
        </select>
      </div>
      <div style="margin-top:8px;">
        <input id="inpTags" class="input" placeholder="标签（用逗号分隔）例如：guest post, sponsor, high priority" />
      </div>
      <div style="margin-top:8px;">
        <textarea id="txtNotes" placeholder="备注…"></textarea>
      </div>
      <div class="row" style="margin-top:10px; justify-content:space-between;">
        <button id="btnSave" class="btn btn-primary">保存</button>
        <button id="btnOpenOptions" class="btn btn-ghost">Settings</button>
      </div>
    </div>

    <div class="card">
      <h3>最近保存</h3>
      <div id="history" class="muted">加载中…</div>
    </div>
  `;

  document.getElementById("btnOpenOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.getElementById("btnSave").addEventListener("click", async () => {
    const status = document.getElementById("selStatus").value;
    const tags = (document.getElementById("inpTags").value || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const notes = document.getElementById("txtNotes").value || "";
    const res = await chrome.runtime.sendMessage({ type: "LR_SAVE_PAGE", analysis, status, tags, notes });
    if (!res?.ok) return toast(res?.error || "保存失败");
    toast("已保存");
    await loadHistory();
  });

  loadHistory();
}


async function loadHistory() {
  const el = document.getElementById("history");
  const res = await chrome.runtime.sendMessage({ type: "LR_GET_HISTORY", limit: 10 });
  if (!res?.ok) {
    el.innerHTML = `<div class="error">${escapeHtml(res?.error || "加载失败")}</div>`;
    return;
  }
  const list = res.list || [];
  if (!list.length) {
    el.innerHTML = `<div class="muted">暂无保存记录。</div>`;
    return;
  }
  el.innerHTML = list
    .map(
      (p) => `
    <div style="padding:8px 0; border-top:1px solid rgba(255,255,255,0.06);">
      <div style="display:flex; justify-content:space-between; gap:8px;">
        <div style="min-width:0;">
          <div class="link-domain" title="${escapeHtmlAttr(p.title || "")}">${escapeHtml(p.title || "(无标题)")}</div>
          <div class="small">${escapeHtml(p.domain)} · ${escapeHtml(p.status)} · ${escapeHtml(String(p.score))}</div>
        </div>
        <button class="btn btn-ghost" data-openpage="${escapeHtmlAttr(p.url)}">Open</button>
      </div>
    </div>
  `
    )
    .join("");

  for (const b of Array.from(document.querySelectorAll("[data-openpage]"))) {
    b.addEventListener("click", () => chrome.tabs.create({ url: b.getAttribute("data-openpage") }));
  }
}

function suggestNextAction(a) {
  const score = a.score ?? 0;
  const comp = (a.competitorMentions || []).length;
  const commercial = (a.commercialSignals || []).length;
  if (score >= 90) return { primary: "强机会：优先 Outreach/投放", reason: "正文外链占比高、推荐特征明显，且有可解释信号支撑。" };
  if (score >= 70) return { primary: "值得跟进：优先收录+备注", reason: `命中竞品 ${comp} 个${commercial ? "，且存在商业痕迹" : ""}，建议进入待联系队列。` };
  if (score >= 50) return { primary: "观察：先保存，后续再看", reason: "信号一般，建议先沉淀到库里，后续结合更多页面再判断。" };
  return { primary: "低价值：可忽略或标记无价值", reason: "正文外链少/噪音高/目录倾向，建议谨慎投入时间。" };
}

function renderBullets(items) {
  if (!items?.length) return `<div class="muted">无</div>`;
  return `<ul style="margin:6px 0 0 18px; padding:0;">${items.map((x) => `<li style="margin:6px 0;">${escapeHtml(x)}</li>`).join("")}</ul>`;
}

function toast(text) {
  // V1：简单 toast（复用 meta 行）
  els.pageMeta.textContent = text;
  setTimeout(() => {
    if (analysis) els.pageMeta.textContent = `${analysis.domain}  |  ${analysis.pageType}`;
  }, 1400);
}

function escapeHtml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeHtmlAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
