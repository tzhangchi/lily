if (!globalThis.__LILY_LINK_RADAR_CONTENT_SCRIPT__) {
  globalThis.__LILY_LINK_RADAR_CONTENT_SCRIPT__ = true;

const STATE = {
  highlighted: false,
  highlightCssInjected: false,
  lastLinks: [] // 用于高亮（避免重复扫描）
};

// ========== V1：Content Script 必须“单文件可运行”（避免 module import 兼容性问题） ==========

const TRACKING_QUERY_PREFIXES = ["utm_"];
const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "yclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
  "campaign",
  "coupon",
  "coupon_code",
  "aff",
  "affiliate",
  "aff_id",
  "affid",
  "partner",
  "sponsor",
  "spm"
]);

const SOCIAL_DOMAINS = new Set([
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "linkedin.com",
  "youtube.com",
  "reddit.com",
  "discord.com",
  "medium.com",
  "github.com"
]);

const NOISE_ANCHOR_KEYWORDS = ["privacy", "terms", "login", "sign in", "signup", "sign up", "register", "cookie", "policy"];

function safeLower(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeUrl(rawUrl, baseUrl) {
  try {
    const u = new URL(rawUrl, baseUrl);
    if (!(u.protocol === "http:" || u.protocol === "https:")) return null;
    u.hash = "";
    const toDelete = [];
    for (const [k] of u.searchParams.entries()) {
      const lk = safeLower(k);
      if (TRACKING_QUERY_KEYS.has(lk)) toDelete.push(k);
      if (TRACKING_QUERY_PREFIXES.some((p) => lk.startsWith(p))) toDelete.push(k);
    }
    toDelete.forEach((k) => u.searchParams.delete(k));
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return null;
  }
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function getRootDomain(hostname) {
  const parts = (hostname || "").split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

function isExternalLink(url, pageUrl) {
  try {
    const u = new URL(url);
    const p = new URL(pageUrl);
    return u.hostname && u.hostname !== p.hostname;
  } catch {
    return false;
  }
}

function extractRelFlags(aEl) {
  const rel = safeLower(aEl.getAttribute("rel"));
  const parts = rel ? rel.split(/\s+/).filter(Boolean) : [];
  const set = new Set(parts);
  return { rel: parts, isNofollow: set.has("nofollow"), isSponsored: set.has("sponsored"), isUgc: set.has("ugc") };
}

function looksLikeAffiliate(url) {
  try {
    const u = new URL(url);
    for (const [k, v] of u.searchParams.entries()) {
      const lk = safeLower(k);
      const lv = safeLower(v);
      if (TRACKING_QUERY_KEYS.has(lk)) return true;
      if (TRACKING_QUERY_PREFIXES.some((p) => lk.startsWith(p))) return true;
      if (["ref", "aff", "affiliate", "partner", "coupon"].includes(lk)) return true;
      if (lv.includes("affiliate") || lv.includes("partner")) return true;
    }
    const path = safeLower(u.pathname);
    if (path.includes("/ref/") || path.includes("/go/") || path.includes("/out/") || path.includes("/recommend/")) return true;
    return false;
  } catch {
    return false;
  }
}

function classifyCategory(url) {
  try {
    const u = new URL(url);
    const host = safeLower(u.hostname);
    const root = getRootDomain(host);
    const path = safeLower(u.pathname);
    if (SOCIAL_DOMAINS.has(root) || SOCIAL_DOMAINS.has(host)) return "social";
    if (looksLikeAffiliate(url)) return "affiliate";
    if (path.includes("/login") || path.includes("/signin") || path.includes("/sign-in")) return "login";
    if (path.includes("/signup") || path.includes("/sign-up") || path.includes("/register")) return "register";
    if (path.includes("/docs") || path.includes("/documentation")) return "doc";
    if (path.includes("/download") || path.endsWith(".zip") || path.endsWith(".dmg") || path.endsWith(".exe")) return "download";
    if (path.includes("/blog") || path.includes("/posts") || path.includes("/article")) return "blog";
    if (path === "/" || path.split("/").filter(Boolean).length <= 1) return "product";
    return "other";
  } catch {
    return "other";
  }
}

function likelyNoiseLink({ location, anchorText, url }) {
  const a = safeLower(anchorText);
  const u = safeLower(url);
  if (location === "nav" || location === "footer") return true;
  if (NOISE_ANCHOR_KEYWORDS.some((k) => a.includes(k))) return true;
  if (u.includes("privacy") || u.includes("terms") || u.includes("cookie")) return true;
  return false;
}

function injectHighlightCssOnce() {
  if (STATE.highlightCssInjected) return;
  const style = document.createElement("style");
  style.id = "lr-highlight-style";
  style.textContent = `
    :root {
      --lr-accent: #0071e3;
      --lr-border: rgba(0,0,0,0.10);
      --lr-shadow: 0 18px 48px rgba(0,0,0,0.18);
      --lr-glass: rgba(255,255,255,0.82);
      --lr-text: #1d1d1f;
      --lr-muted: #6e6e73;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --lr-accent: #0a84ff;
        --lr-border: rgba(255,255,255,0.16);
        --lr-shadow: 0 22px 60px rgba(0,0,0,0.52);
        --lr-glass: rgba(28,28,30,0.78);
        --lr-text: #f5f5f7;
        --lr-muted: #a1a1a6;
      }
    }
    .lr-highlighted-link {
      outline: 2px solid var(--lr-accent) !important;
      outline-offset: 2px !important;
      border-radius: 6px !important;
      background: color-mix(in srgb, var(--lr-accent) 12%, transparent) !important;
    }
    .lr-tooltip {
      position: fixed;
      z-index: 2147483647;
      max-width: 420px;
      padding: 12px 14px;
      background: var(--lr-glass);
      color: var(--lr-text);
      font-size: 12px;
      line-height: 1.4;
      border-radius: 16px;
      border: 1px solid var(--lr-border);
      box-shadow: var(--lr-shadow);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      pointer-events: none;
      white-space: pre-wrap;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
    }
    .lr-tooltip .lr-tip-meta { margin-top: 8px; font-size: 11px; color: var(--lr-muted); }
  `;
  document.documentElement.appendChild(style);
  STATE.highlightCssInjected = true;
}

function getLinkLocation(a) {
  // 位置识别（V1 规则版）
  const loc = (el) => (el ? el.tagName?.toLowerCase() : "");
  const closest = (sel) => a.closest(sel);

  if (closest("nav,[role='navigation']")) return "nav";
  if (closest("footer")) return "footer";
  if (closest("header")) return "nav";
  if (closest("aside")) return "sidebar";
  if (closest("[role='complementary']")) return "sidebar";
  if (closest("#comments,.comments,[data-comments],.comment,comment")) return "comment";
  if (closest("main,article,[role='main']")) return "content";

  // heuristic by class/id hints
  const container = a.closest("section,div,ul,ol");
  const hint = safeLower(container?.className || "") + " " + safeLower(container?.id || "");
  if (hint.includes("footer")) return "footer";
  if (hint.includes("nav")) return "nav";
  if (hint.includes("sidebar") || hint.includes("aside")) return "sidebar";
  if (hint.includes("comment")) return "comment";

  // fallback: body children
  const tag = loc(a.parentElement);
  if (tag === "footer") return "footer";
  if (tag === "nav") return "nav";
  return "unknown";
}

function getAnchorText(a) {
  const text = (a.textContent || "").replace(/\s+/g, " ").trim();
  if (text) return text;
  const aria = a.getAttribute("aria-label");
  if (aria) return aria.trim();
  const title = a.getAttribute("title");
  if (title) return title.trim();
  return "";
}

function getContextText(a, maxLen = 240) {
  // V1：取最近可读容器段落的文本，截断前后
  const container = a.closest("p,li,blockquote,figcaption,dd,dt,td") || a.parentElement;
  const t = (container?.textContent || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= maxLen) return t;
  const anchor = getAnchorText(a);
  const idx = anchor ? t.toLowerCase().indexOf(anchor.toLowerCase()) : -1;
  if (idx >= 0) {
    const start = Math.max(0, idx - Math.floor(maxLen / 2));
    const end = Math.min(t.length, start + maxLen);
    return (start > 0 ? "…" : "") + t.slice(start, end) + (end < t.length ? "…" : "");
  }
  return t.slice(0, maxLen) + "…";
}

function analyzeLinks(settings) {
  const pageUrl = location.href;
  const title = document.title || "";
  const pageHost = getHostname(pageUrl);
  const pageDomain = getRootDomain(pageHost);
  const allPageLinks = collectAllPageLinks(pageUrl);

  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const map = new Map(); // normalizedUrl -> extractedLink

  for (const a of anchors) {
    const rawHref = a.getAttribute("href");
    const normalized = normalizeUrl(rawHref, pageUrl);
    if (!normalized) continue;
    if (!isExternalLink(normalized, pageUrl)) continue;

    const urlHost = getHostname(normalized);
    const domain = getRootDomain(urlHost);
    const anchorText = getAnchorText(a);
    const locationType = getLinkLocation(a);
    const relFlags = extractRelFlags(a);
    const category = classifyCategory(normalized);

    const key = normalized;
    const existing = map.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
      continue;
    }

    const isCompetitor = matchAnyKeyword(`${domain} ${anchorText} ${normalized}`, settings.competitorKeywords);

    map.set(key, {
      url: normalized,
      domain,
      anchorText,
      location: locationType,
      rel: relFlags.rel,
      isNofollow: relFlags.isNofollow,
      isSponsored: relFlags.isSponsored,
      isUgc: relFlags.isUgc,
      isCompetitor,
      category,
      contextText: getContextText(a),
      occurrenceCount: 1
    });
  }

  let links = Array.from(map.values());
  const totalLinks = links.length;

  const noiseCount = links.filter((l) => likelyNoiseLink(l)).length;
  const contentLinks = links.filter((l) => l.location === "content").length;
  const competitorMentions = uniq(
    links
      .filter((l) => l.isCompetitor)
      .map((l) => l.domain)
  );
  const commercialSignals = detectCommercialSignals(links);

  const pageType = detectPageType({ title, links, contentLinks });
  const score = calcOpportunityScore({
    pageType,
    totalLinks,
    contentLinks,
    competitorCount: competitorMentions.length,
    commercialSignalCount: commercialSignals.length,
    noiseCount,
    title
  });

  const myMissing = !matchAnyKeyword(`${title} ${document.body?.innerText || ""}`, settings.myProductKeywords);

  const summary = makeSummary({
    pageType,
    totalLinks,
    contentLinks,
    competitorCount: competitorMentions.length,
    hasCommercial: commercialSignals.length > 0,
    myMissing
  });
  const insights = makeInsights({
    pageType,
    totalLinks,
    contentLinks,
    competitorMentions,
    commercialSignals,
    myMissing,
    noiseCount
  });

  const seo = analyzeSeo({ pageUrl, title });
  const pageBrief = analyzePageBrief({ pageUrl, title, seo });
  // 给 AI 使用的文本样本（避免 payload 过大）
  const textSample = getSeoText().slice(0, 12_000);

  // 排序：正文优先，产品/affiliate/competitor 再优先
  links.sort((a, b) => {
    const w = (l) => {
      let s = 0;
      if (l.location === "content") s += 30;
      if (l.isCompetitor) s += 20;
      if (l.isSponsored) s += 10;
      if (l.category === "product") s += 8;
      if (l.category === "affiliate") s += 6;
      if (l.isNofollow) s -= 2;
      return s;
    };
    return w(b) - w(a);
  });

  STATE.lastLinks = links;

  return {
    url: pageUrl,
    title,
    domain: pageDomain,
    pageType,
    score,
    totalLinks,
    externalLinks: totalLinks,
    allPageLinks,
    allLinksCount: allPageLinks.length,
    contentLinks,
    competitorMentions,
    commercialSignals,
    summary,
    insights,
    seo,
    pageBrief,
    textSample,
    analyzedAt: new Date().toISOString(),
    links
  };
}

function collectAllPageLinks(pageUrl) {
  const pageHost = getHostname(pageUrl);
  const items = [];
  const seen = new Set();
  const anchors = Array.from(document.querySelectorAll("a[href]"));

  for (const a of anchors) {
    const rawHref = (a.getAttribute("href") || "").trim();
    if (!rawHref) continue;
    const absolute = toAbsoluteHref(rawHref, pageUrl);
    const key = absolute || rawHref;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const protocol = getHrefProtocol(absolute || rawHref);
    const domain = absolute ? getRootDomain(getHostname(absolute)) : "";
    const sameDomain = absolute ? getHostname(absolute) === pageHost : false;

    items.push({
      href: absolute || rawHref,
      rawHref,
      anchorText: getAnchorText(a),
      title: cleanText(a.getAttribute("title") || ""),
      ariaLabel: cleanText(a.getAttribute("aria-label") || ""),
      location: getLinkLocation(a),
      protocol,
      domain,
      sameDomain,
      isExternal: absolute ? !sameDomain : false
    });
  }

  return items;
}

function toAbsoluteHref(rawHref, baseUrl) {
  try {
    const u = new URL(rawHref, baseUrl);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:" || u.protocol === "tel:") {
      return u.toString();
    }
    return rawHref;
  } catch {
    return rawHref;
  }
}

function getHrefProtocol(href) {
  try {
    const u = new URL(href, location.href);
    return u.protocol.replace(":", "");
  } catch {
    const idx = href.indexOf(":");
    return idx > 0 ? href.slice(0, idx) : "relative";
  }
}

function matchAnyKeyword(haystack, keywords = []) {
  const h = safeLower(haystack);
  return (keywords || []).some((k) => {
    const kk = safeLower(k);
    if (!kk) return false;
    return h.includes(kk);
  });
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function detectCommercialSignals(links) {
  const signals = new Set();
  for (const l of links) {
    if (l.isSponsored) signals.add("rel=sponsored");
    if (l.isUgc) signals.add("rel=ugc");
    if (l.url.includes("utm_") || l.url.includes("gclid=") || l.url.includes("fbclid=")) signals.add("tracking_params");
    if (l.category === "affiliate") signals.add("affiliate_like");
    if (safeLower(l.url).includes("coupon") || safeLower(l.anchorText).includes("coupon")) signals.add("coupon/deal");
    if (safeLower(l.anchorText).includes("sponsor") || safeLower(l.anchorText).includes("partner")) signals.add("sponsored_keywords");
  }
  return Array.from(signals);
}

function detectPageType({ title, links, contentLinks }) {
  const t = safeLower(title);
  const kwListicle = ["best", "top", "alternatives", "alternative", "tools", "recommended", "recommend", "list", "roundup"];
  const kwReview = ["review", "vs", "compare", "comparison", "pricing", "coupon", "deal"];

  const manyLinks = links.length >= 10;
  const contentRatio = links.length ? contentLinks / links.length : 0;

  if (kwListicle.some((k) => t.includes(k)) && manyLinks && contentRatio >= 0.4) return "listicle";
  if (kwReview.some((k) => t.includes(k)) && contentRatio >= 0.3) return "review";
  if (manyLinks && contentRatio < 0.25) return "directory";
  if (t.includes("news") || t.includes("press") || t.includes("announc")) return "news";
  return "other";
}

function calcOpportunityScore({ pageType, totalLinks, contentLinks, competitorCount, commercialSignalCount, noiseCount, title }) {
  let s = 50;
  const ratio = totalLinks ? contentLinks / totalLinks : 0;

  // 内容外链比
  s += clamp(Math.round((ratio - 0.3) * 60), -20, 25);

  // 页面类型加成
  if (pageType === "listicle") s += 18;
  else if (pageType === "review") s += 10;
  else if (pageType === "directory") s -= 10;

  // 竞品与商业痕迹
  s += clamp(competitorCount * 3, 0, 18);
  s += clamp(commercialSignalCount * 4, 0, 16);

  // 噪音惩罚
  s -= clamp(noiseCount * 1, 0, 15);

  // 标题强相关（包含推荐词）
  const t = safeLower(title);
  if (["best", "top", "alternatives", "review", "compare"].some((k) => t.includes(k))) s += 6;

  return clamp(s, 0, 100);
}

function makeSummary({ pageType, totalLinks, contentLinks, competitorCount, hasCommercial, myMissing }) {
  const typeMap = {
    listicle: "推荐/榜单页",
    review: "测评/对比页",
    comparison: "对比页",
    news: "新闻页",
    directory: "目录页",
    other: "文章页"
  };
  const parts = [];
  parts.push(`这是一篇${typeMap[pageType] || "页面"}，共发现外链 ${totalLinks} 条（正文 ${contentLinks} 条）`);
  if (competitorCount > 0) parts.push(`命中竞品 ${competitorCount} 个`);
  if (hasCommercial) parts.push("存在 affiliate/sponsor 等商业痕迹");
  if (myMissing) parts.push("可能未提及你的产品（可作为 outreach 机会）");
  return parts.join("，") + "。";
}

function makeInsights({ pageType, totalLinks, contentLinks, competitorMentions, commercialSignals, myMissing, noiseCount }) {
  const insights = [];
  const ratio = totalLinks ? Math.round((contentLinks / totalLinks) * 100) : 0;
  insights.push(`正文外链占比 ${ratio}%（噪音链接约 ${noiseCount} 条）`);
  if (pageType === "listicle") insights.push("标题/结构呈现榜单推荐特征，适合评估投放/合作");
  if (pageType === "directory") insights.push("更像目录/聚合页，建议谨慎（先看内容质量与编辑性）");
  if (commercialSignals.length) insights.push(`商业痕迹：${commercialSignals.join("、")}`);
  if (competitorMentions.length) insights.push(`竞品域名示例：${competitorMentions.slice(0, 5).join("、")}${competitorMentions.length > 5 ? "…" : ""}`);
  if (myMissing) insights.push("未检索到你的产品关键词，优先作为“竞品有覆盖但你缺失”的外联对象");
  return insights.slice(0, 5);
}

// =========================
// SEO / Landing Page Checks
// =========================

const SEO_STOPWORDS_EN = new Set([
  "the","a","an","and","or","but","to","of","in","on","for","with","as","at","by","from","is","are","was","were","be","been","being",
  "it","its","this","that","these","those","you","your","we","our","they","their","i","my","me",
  "can","could","should","would","will","just","not","no","yes","more","most","all","any","some",
  "how","what","when","where","why","who","which","than","then","there","here"
]);

const SEO_STOPWORDS_ZH = new Set(["我们", "你", "你们", "他们", "她们", "它们", "的", "了", "和", "与", "及", "或", "在", "是", "为", "对", "把", "这", "那", "一个", "一种"]);

function analyzeSeo({ pageUrl, title }) {
  const description = (document.querySelector('meta[name="description"]')?.getAttribute("content") || "").trim();

  const canonicalEls = Array.from(document.querySelectorAll('link[rel="canonical"]'));
  const canonicals = canonicalEls
    .map((el) => normalizeUrl(el.getAttribute("href") || "", pageUrl))
    .filter(Boolean);
  const canonical = canonicals[0] || "";

  const h1 = Array.from(document.querySelectorAll("h1"))
    .map((x) => (x.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const text = getSeoText();
  const tokens = tokenizeSeo(text);
  const keywordStats = rankKeywords(tokens, 10);
  const primaryKeyword = keywordStats.top?.[0]?.term || "";

  const social = extractSocialMeta();
  const serp = buildSerpPreview({ pageUrl, title, description, primaryKeyword });
  const issues = buildSeoIssues({
    pageUrl,
    title,
    description,
    canonicals,
    h1,
    tokenCount: tokens.totalTokens,
    social
  });

  return {
    title,
    description,
    canonical,
    canonicals,
    h1,
    wordCount: tokens.wordCount,
    zhCharCount: tokens.zhCharCount,
    tokenCount: tokens.totalTokens,
    keywordDensity: keywordStats,
    primaryKeyword,
    serp,
    social,
    issues
  };
}

function getSeoText() {
  // 优先抓 main/article，其次 body（innerText 会自动忽略 script/style）
  const el =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.querySelector("[role='main']") ||
    document.body;
  return (el?.innerText || "").replace(/\s+/g, " ").trim();
}

function tokenizeSeo(text) {
  const t = safeLower(text);

  const en = (t.match(/[a-z]{2,}/g) || []).filter((w) => !SEO_STOPWORDS_EN.has(w));
  const zh = (text.match(/[\u4e00-\u9fff]{2,}/g) || []).filter((w) => !SEO_STOPWORDS_ZH.has(w));

  // 用于“单词数量”：英文按单词，中文按汉字数（更接近直觉）
  const wordCount = en.length;
  const zhCharCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;

  const all = [];
  for (const w of en) all.push(w);
  for (const w of zh) all.push(w);

  return { tokens: all, totalTokens: all.length, wordCount, zhCharCount };
}

function rankKeywords(tokenized, topN = 10) {
  const map = new Map();
  for (const w of tokenized.tokens) map.set(w, (map.get(w) || 0) + 1);
  const list = Array.from(map.entries())
    .map(([term, count]) => ({ term, count, density: tokenized.totalTokens ? count / tokenized.totalTokens : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
  return { totalTokens: tokenized.totalTokens, top: list };
}

function extractSocialMeta() {
  const get = (selector, attr) => (document.querySelector(selector)?.getAttribute(attr) || "").trim();
  const og = {
    "og:title": get('meta[property="og:title"]', "content"),
    "og:description": get('meta[property="og:description"]', "content"),
    "og:image": get('meta[property="og:image"]', "content"),
    "og:url": get('meta[property="og:url"]', "content"),
    "og:type": get('meta[property="og:type"]', "content")
  };
  const twitter = {
    "twitter:card": get('meta[name="twitter:card"]', "content"),
    "twitter:title": get('meta[name="twitter:title"]', "content"),
    "twitter:description": get('meta[name="twitter:description"]', "content"),
    "twitter:image": get('meta[name="twitter:image"]', "content")
  };
  return { og, twitter };
}

function buildSerpPreview({ pageUrl, title, description, primaryKeyword }) {
  let displayUrl = pageUrl;
  try {
    const u = new URL(pageUrl);
    displayUrl = `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {}

  const q1 = primaryKeyword ? `${primaryKeyword} landing page` : "landing page layout";
  const q2 = primaryKeyword ? `${primaryKeyword} alternatives` : "landing page examples";
  const q3 = "落地页 布局";

  const toGoogle = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

  return {
    displayUrl,
    title,
    description,
    recommendedTitleLen: "30-60",
    recommendedDescLen: "70-160",
    searchLinks: [
      { label: `Google: ${q1}`, url: toGoogle(q1) },
      { label: `Google: ${q2}`, url: toGoogle(q2) },
      { label: `Google: ${q3}`, url: toGoogle(q3) }
    ]
  };
}

function buildSeoIssues({ pageUrl, title, description, canonicals, h1, tokenCount, social }) {
  const issues = [];
  const tLen = (title || "").trim().length;
  const dLen = (description || "").trim().length;

  if (!title) issues.push({ level: "error", text: "缺少 <title>（SERP 标题）" });
  else {
    if (tLen < 15) issues.push({ level: "warn", text: `标题偏短（${tLen}）建议 30-60 字符` });
    if (tLen > 70) issues.push({ level: "warn", text: `标题偏长（${tLen}）可能在 SERP 被截断` });
  }

  if (!description) issues.push({ level: "warn", text: '缺少 meta description（<meta name="description">）' });
  else {
    if (dLen < 70) issues.push({ level: "warn", text: `描述偏短（${dLen}）建议 70-160 字符` });
    if (dLen > 200) issues.push({ level: "warn", text: `描述偏长（${dLen}）可能在 SERP 被截断` });
  }

  if (!canonicals.length) issues.push({ level: "warn", text: '缺少 canonical（<link rel="canonical">）' });
  if (canonicals.length > 1) issues.push({ level: "warn", text: `canonical 重复（${canonicals.length} 个）建议只保留 1 个` });

  if (!h1.length) issues.push({ level: "warn", text: "缺少 H1（建议 1 个且围绕主关键词）" });
  if (h1.length > 1) issues.push({ level: "warn", text: `H1 数量过多（${h1.length} 个）建议只保留 1 个` });

  if (tokenCount < 200) issues.push({ level: "warn", text: `正文内容偏少（粗略 token ${tokenCount}）落地页建议补充更多信息/FAQ` });

  // social
  if (!social?.og?.["og:title"]) issues.push({ level: "info", text: "缺少 og:title（社交分享标题）" });
  if (!social?.og?.["og:description"]) issues.push({ level: "info", text: "缺少 og:description（社交分享描述）" });
  if (!social?.og?.["og:image"]) issues.push({ level: "info", text: "缺少 og:image（社交分享图）" });
  if (!social?.twitter?.["twitter:card"]) issues.push({ level: "info", text: "缺少 twitter:card（Twitter/X 分享卡片类型）" });

  // robots noindex
  const robots = (document.querySelector('meta[name="robots"]')?.getAttribute("content") || "").toLowerCase();
  if (robots.includes("noindex")) issues.push({ level: "error", text: "robots 包含 noindex（页面可能不会被收录）" });

  // lang
  const lang = document.documentElement?.getAttribute?.("lang") || "";
  if (!lang) issues.push({ level: "info", text: "html 缺少 lang 属性（可提升可访问性与语种识别）" });

  // canonical mismatch (粗略)
  if (canonicals.length && canonicals[0] && canonicals[0] !== pageUrl) {
    issues.push({ level: "info", text: "canonical 与当前 URL 不同（确认是否为预期的规范化）" });
  }

  return issues;
}

// =========================
// Landing Page Brief / Export
// =========================

const LANDING_PATTERNS = {
  discount: [
    "off",
    "discount",
    "deal",
    "sale",
    "save",
    "coupon",
    "limited",
    "black friday",
    "cyber monday",
    "折扣",
    "优惠",
    "限时",
    "立减",
    "买一送一",
    "促销"
  ],
  free: ["free", "try free", "start free", "get started", "免费", "免费试用", "立即免费", "开始使用"],
  switcher: ["tab", "tabs", "switch", "toggle", "segmented", "切换", "标签"],
  model: ["model", "gpt", "claude", "gemini", "llama", "flux", "stable diffusion", "默认模型", "模型"],
  examples: ["example", "gallery", "showcase", "case", "template", "效果", "案例", "模板", "画廊"],
  history: ["history", "recent", "record", "generated", "generation", "生成记录", "历史", "记录"],
  sidebar: ["sidebar", "aside", "drawer", "side", "侧边栏"],
  trust: ["review", "rating", "testimonial", "customer", "trusted", "stars", "评分", "评价", "客户", "信任"]
};

function analyzePageBrief({ pageUrl, title, seo }) {
  const candidates = getVisibleCandidates();
  const pick = (kind, limit = 8) => findByPatterns(candidates, LANDING_PATTERNS[kind] || [], limit);
  const discountBanners = pick("discount", 6);
  const freeButtons = pick("free", 8);
  const pageSwitches = detectPageSwitches(candidates);
  const defaultModels = pick("model", 8);
  const examples = pick("examples", 8);
  const generationHistory = pick("history", 8);
  const sidebarFeatures = detectSidebarFeatures();
  const trustSignals = pick("trust", 8);
  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .filter(isVisibleElement)
    .slice(0, 40)
    .map((el) => ({
      level: el.tagName.toLowerCase(),
      text: cleanText(el.textContent).slice(0, 180)
    }))
    .filter((x) => x.text);
  const images = extractKeyImages();
  const ctas = extractCtas(candidates);
  const navItems = extractNavItems();
  const visualStyle = extractVisualStyle();
  const sectionTree = buildSectionTree();
  const structure = buildHtmlStructureMarkdown();
  const htmlSkeleton = buildHtmlSkeletonMarkdown();
  const viewportSnapshot = extractViewportSnapshot(sectionTree);
  const forms = Array.from(document.querySelectorAll("form,input[type='email'],input[type='search'],textarea"))
    .filter(isVisibleElement)
    .slice(0, 12)
    .map((el) => summarizeElement(el))
    .filter((x) => x.text || x.label);
  const componentInventory = buildComponentInventory({
    ctas,
    navItems,
    forms,
    images,
    pageSwitches,
    sidebarFeatures,
    trustSignals,
    sectionTree
  });
  const highlights = summarizeHighlights({ seo, ctas, headings, images });
  const markdown = buildPageMarkdown({
    pageUrl,
    title,
    seo,
    highlights,
    headings,
    images,
    ctas,
    discountBanners,
    freeButtons,
    pageSwitches,
    defaultModels,
    examples,
    generationHistory,
    sidebarFeatures,
    navItems,
    forms,
    trustSignals,
    visualStyle,
    sectionTree,
    structure,
    htmlSkeleton,
    viewportSnapshot,
    componentInventory
  });

  return {
    highlights,
    discountBanners,
    freeButtons,
    ctas,
    headings,
    pageSwitches,
    defaultModels,
    examples,
    generationHistory,
    sidebarFeatures,
    navItems,
    forms,
    trustSignals,
    images,
    visualStyle,
    sectionTree,
    structure,
    htmlSkeleton,
    viewportSnapshot,
    componentInventory,
    markdown
  };
}

function getVisibleCandidates() {
  const selector = [
    "header",
    "nav",
    "main",
    "section",
    "article",
    "aside",
    "footer",
    "button",
    "a",
    "[role='button']",
    "[role='tab']",
    "[role='switch']",
    "[role='navigation']",
    "[aria-label]",
    "[class]",
    "[id]"
  ].join(",");
  return Array.from(document.querySelectorAll(selector))
    .filter(isVisibleElement)
    .slice(0, 900)
    .map((el) => summarizeElement(el))
    .filter((x) => x.text || x.label || x.hint);
}

function summarizeElement(el) {
  const tag = el.tagName?.toLowerCase?.() || "";
  const role = el.getAttribute?.("role") || "";
  const label = cleanText(el.getAttribute?.("aria-label") || el.getAttribute?.("title") || el.getAttribute?.("placeholder") || "");
  const text = cleanText(el.innerText || el.textContent || "");
  const classId = safeLower(`${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`);
  const href = tag === "a" ? normalizeUrl(el.getAttribute("href") || "", location.href) : "";
  const imgAlt = tag === "img" ? cleanText(el.getAttribute("alt") || "") : "";
  return {
    tag,
    signature: getHtmlSignature(el),
    role,
    label,
    text: (label || text || imgAlt).slice(0, 260),
    hint: classId.slice(0, 220),
    location: getElementLocation(el),
    viewportPosition: getViewportDescriptor(el).position,
    href
  };
}

function findByPatterns(candidates, patterns, limit) {
  const seen = new Set();
  const result = [];
  for (const item of candidates) {
    const haystack = safeLower(`${item.text} ${item.label} ${item.hint} ${item.role}`);
    if (!patterns.some((p) => haystack.includes(p))) continue;
    const key = safeLower(`${item.location}:${item.text || item.label}:${item.hint}`);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function extractCtas(candidates) {
  const strong = ["free", "start", "try", "sign up", "get started", "download", "buy", "upgrade", "create", "generate", "免费", "开始", "生成", "立即", "下载", "购买", "注册"];
  return candidates
    .filter((item) => ["button", "a"].includes(item.tag) || item.role === "button")
    .filter((item) => {
      const h = safeLower(`${item.text} ${item.label} ${item.hint}`);
      return strong.some((p) => h.includes(p));
    })
    .slice(0, 14);
}

function detectPageSwitches(candidates) {
  return candidates
    .filter((item) => {
      const h = safeLower(`${item.tag} ${item.role} ${item.text} ${item.label} ${item.hint}`);
      return item.role === "tab" || item.role === "switch" || LANDING_PATTERNS.switcher.some((p) => h.includes(p));
    })
    .slice(0, 12);
}

function detectSidebarFeatures() {
  const roots = Array.from(document.querySelectorAll("aside,[role='complementary'],[class*='sidebar'],[class*='side-bar'],[id*='sidebar'],[id*='side-bar']"))
    .filter(isVisibleElement)
    .slice(0, 6);
  const features = [];
  for (const root of roots) {
    const title = cleanText(root.querySelector("h1,h2,h3,[aria-label]")?.textContent || root.getAttribute("aria-label") || "Sidebar");
    const items = Array.from(root.querySelectorAll("a,button,[role='button'],li"))
      .filter(isVisibleElement)
      .map((el) => cleanText(el.innerText || el.textContent || el.getAttribute("aria-label") || ""))
      .filter(Boolean)
      .slice(0, 18);
    features.push({ title, items });
  }
  return features;
}

function extractNavItems() {
  return Array.from(document.querySelectorAll("nav a,nav button,header a,header button"))
    .filter(isVisibleElement)
    .map((el) => cleanText(el.innerText || el.textContent || el.getAttribute("aria-label") || ""))
    .filter(Boolean)
    .slice(0, 30);
}

function extractKeyImages() {
  return Array.from(document.images || [])
    .filter(isVisibleElement)
    .map((img) => ({
      alt: cleanText(img.getAttribute("alt") || ""),
      src: normalizeUrl(img.currentSrc || img.src || "", location.href) || "",
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
      location: getElementLocation(img)
    }))
    .filter((img) => img.src)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, 18);
}

function summarizeHighlights({ seo, ctas, headings, images }) {
  const out = [];
  if (headings[0]?.text) out.push(`首屏主标题：${headings[0].text}`);
  if (ctas[0]?.text) out.push(`主要 CTA：${ctas[0].text}`);
  if (seo?.primaryKeyword) out.push(`候选关键词：${seo.primaryKeyword}`);
  if (images[0]?.alt) out.push(`关键图片：${images[0].alt}`);
  return out;
}

function buildPageMarkdown(data) {
  const lines = [];
  const add = (s = "") => lines.push(s);
  const snapshot = data.viewportSnapshot || {};

  add(`# Page Replication Brief: ${data.title || "Untitled Page"}`);
  add("");
  add("## Page Snapshot");
  add(`- URL: ${data.pageUrl}`);
  add(`- Captured viewport: ${snapshot.viewport?.width || window.innerWidth}x${snapshot.viewport?.height || window.innerHeight}, scrollY ${snapshot.viewport?.scrollY ?? Math.round(window.scrollY || 0)}`);
  add(`- Document height: ${snapshot.viewport?.documentHeight || Math.round(document.documentElement?.scrollHeight || 0)}`);
  add(`- Title: ${data.seo?.title || data.title || ""}`);
  add(`- Description: ${data.seo?.description || ""}`);
  add(`- H1: ${(data.seo?.h1 || []).join(" / ") || "未检测到"}`);
  add(`- Page intent: ${(data.highlights || []).join("；") || "未检测到"}`);
  add("");

  add("## Above-the-fold WYSIWYG Summary");
  addViewportSnapshotMarkdown(lines, snapshot);
  add("");

  add("## Page Reconstruction Tree");
  addSectionTreeMarkdown(lines, data.sectionTree || []);
  add("");

  add("## Section-by-section Blueprint");
  addSectionBlueprintMarkdown(lines, data.sectionTree || []);
  add("");

  add("## HTML Structure Skeleton");
  add("```html");
  add(data.htmlSkeleton || data.structure || "<!-- 未检测到可读结构 -->");
  add("```");
  add("");

  add("## Visual Style System");
  addVisualStyleMarkdown(lines, data.visualStyle);
  add("");

  add("## Component Inventory");
  addComponentInventoryMarkdown(lines, data.componentInventory || {}, data);
  add("");

  add("## Conversion Architecture");
  addConversionArchitectureMarkdown(lines, data);
  add("");

  add("## SEO Extract");
  addSeoExtractMarkdown(lines, data.seo || {});
  add("");

  add("## Images And Media");
  addImagesMarkdown(lines, data.images || []);
  add("");

  add("## Replication Prompt");
  add("请按以上 Page Reconstruction Tree 和 HTML Structure Skeleton 从上到下复刻页面。优先还原首屏所见顺序、section 语义、真实文案、CTA、图片位置、组件密度、布局宽度、颜色、字体、圆角、阴影和交互状态；SEO 信息只作为元信息和文案意图参考。");
  add("");

  add("## Raw Evidence Appendix");
  addRawEvidenceMarkdown(lines, data);

  return lines.join("\n");
}

function addViewportSnapshotMarkdown(lines, snapshot) {
  const add = (s = "") => lines.push(s);
  const visible = snapshot.visibleOrder || [];
  const sticky = snapshot.stickyElements || [];
  if (!visible.length) {
    add("- 未检测到当前视口内的关键可见元素。");
    return;
  }
  add("- Visual order in current viewport:");
  for (const item of visible.slice(0, 28)) add(`  - ${formatViewportItem(item)}`);
  if (sticky.length) {
    add("- Sticky or fixed elements:");
    for (const item of sticky.slice(0, 10)) add(`  - ${formatViewportItem(item)}`);
  }
}

function formatViewportItem(item) {
  const parts = [
    `${item.order}. ${item.signature || item.tag || "element"}`,
    item.kind ? `[${item.kind}]` : "",
    item.text ? `- ${item.text}` : "",
    item.rectText ? `(${item.rectText})` : "",
    item.viewportPosition ? `{${item.viewportPosition}}` : ""
  ];
  return parts.filter(Boolean).join(" ");
}

function addVisualStyleMarkdown(lines, visualStyle) {
  const add = (s = "") => lines.push(s);
  if (!visualStyle) {
    add("- 未检测到");
    return;
  }
  add(`- Overall: ${visualStyle.overall || ""}`);
  add(`- Background: ${visualStyle.body?.backgroundColor || ""}`);
  add(`- Text: ${visualStyle.body?.color || ""}`);
  add(`- Font: ${visualStyle.body?.fontFamily || ""}`);
  add(`- Layout width: ${visualStyle.layout?.maxWidth || ""}`);
  add(`- Viewport: ${visualStyle.layout?.viewport || ""}`);
  add("");
  add("### Colors");
  if (!(visualStyle.colors || []).length) add("- 未检测到");
  for (const item of visualStyle.colors || []) add(`- ${item.value}: ${item.count}`);
  add("");
  add("### Typography Samples");
  if (!(visualStyle.typography || []).length) add("- 未检测到");
  for (const item of visualStyle.typography || []) {
    add(`- ${item.selector}: ${item.fontSize}, ${item.fontWeight}, line-height ${item.lineHeight}, color ${item.color}`);
  }
  add("");
  add("### Component Samples");
  if (!(visualStyle.components || []).length) add("- 未检测到");
  for (const item of visualStyle.components || []) {
    add(
      `- ${item.selector}: bg ${item.backgroundColor}, color ${item.color}, border ${item.border}, radius ${item.borderRadius}, shadow ${item.boxShadow}, padding ${item.padding}`
    );
  }
}

function formatBriefItem(item) {
  const text = item.text || item.label || item.hint || "";
  const href = item.href ? ` -> ${item.href}` : "";
  const tag = item.signature || item.htmlSignature || item.tag || "page";
  return `- [${item.location || item.viewportPosition || "page"}] ${tag}: ${text}${href}`;
}

function addSectionTreeMarkdown(lines, sectionTree) {
  const add = (s = "") => lines.push(s);
  if (!sectionTree?.length) {
    add("- 未检测到");
    return;
  }
  const walk = (node, depth = 0) => {
    const indent = "  ".repeat(depth);
    const marker = node.viewport?.position ? ` [${node.viewport.position}]` : "";
    add(`${indent}- ${node.htmlSignature || node.label || node.tag}${node.heading ? `: ${node.heading}` : ""}${marker}`);
    if (node.domPath) add(`${indent}  - DOM: ${node.domPath}`);
    if (node.purpose) add(`${indent}  - Purpose: ${node.purpose}`);
    if (node.componentPattern) add(`${indent}  - Pattern: ${node.componentPattern}`);
    if (node.layout?.summary) add(`${indent}  - Layout: ${node.layout.summary}`);
    if (node.styleSummary) add(`${indent}  - Style: ${node.styleSummary}`);
    for (const text of node.texts || []) add(`${indent}  - Text: ${text}`);
    for (const action of node.buttons || []) add(`${indent}  - Button: ${action.text}${action.href ? ` -> ${action.href}` : ""}`);
    for (const link of node.links || []) add(`${indent}  - Link: ${link.text}${link.href ? ` -> ${link.href}` : ""}`);
    for (const img of node.images || []) add(`${indent}  - Image: ${img.alt || "image"} (${img.src || ""})`);
    for (const input of node.forms || []) add(`${indent}  - Form/Input: ${input.label || input.placeholder || input.type || "input"}`);
    for (const tab of node.tabs || []) add(`${indent}  - Tab/Switch: ${tab}`);
    for (const child of node.children || []) walk(child, depth + 1);
  };
  for (const node of sectionTree) walk(node, 0);
}

function addSectionBlueprintMarkdown(lines, sectionTree) {
  const add = (s = "") => lines.push(s);
  if (!sectionTree?.length) {
    add("- 未检测到");
    return;
  }
  const writeNode = (node, path = []) => {
    const index = path.join(".");
    const title = [index, node.label || node.tag, node.heading ? `- ${node.heading}` : ""].filter(Boolean).join(" ");
    add(`### ${title}`);
    add(`- HTML: ${node.htmlSignature || node.tag || "node"}`);
    add(`- DOM path: ${node.domPath || "未检测到"}`);
    add(`- Visual position: ${node.viewport?.position || "unknown"}; rect ${node.viewport?.rectText || "unknown"}`);
    add(`- Layout: ${node.layout?.summary || node.styleSummary || "未检测到"}`);
    add(`- Purpose: ${node.purpose || "推断：页面内容区块或布局容器"}`);
    add(`- Component pattern: ${node.componentPattern || "未检测到"}`);
    add("- Visible copy:");
    if ((node.texts || []).length) for (const text of node.texts || []) add(`  - ${text}`);
    else add("  - 未检测到直接可读文案");
    add("- Actions and links:");
    const actions = [...(node.buttons || []), ...(node.links || [])];
    if (actions.length) for (const action of actions.slice(0, 14)) add(`  - ${action.text || "link"}${action.href ? ` -> ${action.href}` : ""}`);
    else add("  - 未检测到");
    add("- Media:");
    if ((node.images || []).length) for (const img of node.images || []) add(`  - ${img.alt || "image"} | ${img.size || ""} | ${img.src || ""}`);
    else add("  - 未检测到");
    add("- Inputs and states:");
    const states = [...(node.forms || []).map((x) => x.label || x.placeholder || x.type), ...(node.tabs || [])].filter(Boolean);
    if (states.length) for (const state of states.slice(0, 16)) add(`  - ${state}`);
    else add("  - 未检测到");
    if ((node.children || []).length) {
      add("- Child blocks:");
      for (const child of node.children || []) add(`  - ${child.htmlSignature || child.label || child.tag}${child.heading ? `: ${child.heading}` : ""}`);
    }
    add("");
    (node.children || []).forEach((child, idx) => writeNode(child, [...path, idx + 1]));
  };
  sectionTree.forEach((node, idx) => writeNode(node, [idx + 1]));
}

function addComponentInventoryMarkdown(lines, inventory, data) {
  const add = (s = "") => lines.push(s);
  const groups = inventory.groups || [];
  if (!groups.length) {
    add(`- Navigation items: ${(data.navItems || []).length}`);
    add(`- CTA buttons: ${(data.ctas || []).length}`);
    add(`- Forms: ${(data.forms || []).length}`);
    add(`- Images: ${(data.images || []).length}`);
    return;
  }
  for (const group of groups) {
    add(`### ${group.name}`);
    if (!(group.items || []).length) {
      add("- 未检测到");
      continue;
    }
    for (const item of group.items || []) {
      add(`- ${item.label || item.text || item.name || "item"}${item.detail ? ` - ${item.detail}` : ""}`);
    }
  }
}

function addConversionArchitectureMarkdown(lines, data) {
  const add = (s = "") => lines.push(s);
  add("### Offer And Urgency");
  addItemsToLines(lines, data.discountBanners || [], formatBriefItem);
  add("");
  add("### Primary And Secondary CTA");
  addItemsToLines(lines, (data.freeButtons || []).length ? data.freeButtons : data.ctas || [], formatBriefItem);
  add("");
  add("### Navigation / Tabs / Switches");
  addItemsToLines(lines, data.pageSwitches || [], formatBriefItem);
  add("");
  add("### Model / Default State Signals");
  addItemsToLines(lines, data.defaultModels || [], formatBriefItem);
  add("");
  add("### Examples / Proof / History");
  addItemsToLines(lines, [...(data.examples || []), ...(data.generationHistory || []), ...(data.trustSignals || [])], formatBriefItem);
  add("");
  add("### Sidebar Feature Density");
  if (!(data.sidebarFeatures || []).length) add("- 未检测到");
  for (const sidebar of data.sidebarFeatures || []) {
    add(`- ${sidebar.title || "Sidebar"}`);
    for (const item of sidebar.items || []) add(`  - ${item}`);
  }
}

function addSeoExtractMarkdown(lines, seo) {
  const add = (s = "") => lines.push(s);
  add(`- Title: ${seo.title || ""}`);
  add(`- Description: ${seo.description || ""}`);
  add(`- Canonical: ${seo.canonical || "未检测到"}`);
  add(`- Word count: ${seo.wordCount ?? 0}`);
  add(`- Chinese chars: ${seo.zhCharCount ?? 0}`);
  add(`- H1: ${(seo.h1 || []).join(" / ") || "未检测到"}`);
  add("");
  add("### SERP Preview");
  add(`- Title: ${seo.serp?.title || ""}`);
  add(`- URL: ${seo.serp?.displayUrl || ""}`);
  add(`- Description: ${seo.serp?.description || ""}`);
  add("");
  add("### Keyword Density");
  addItemsToLines(lines, seo.keywordDensity?.top || [], (x) => `- ${x.term}: ${x.count} (${(x.density * 100).toFixed(2)}%)`);
  add("");
  add("### SEO Issues");
  addItemsToLines(lines, seo.issues || [], (x) => `- [${x.level}] ${x.text}`);
}

function addImagesMarkdown(lines, images) {
  addItemsToLines(lines, images, (img) => `- ![${img.alt || "image"}](${img.src}) - ${img.width || ""}x${img.height || ""}, ${img.location || ""}`);
}

function addRawEvidenceMarkdown(lines, data) {
  const add = (s = "") => lines.push(s);
  add("### Headings");
  addItemsToLines(lines, data.headings || [], (x) => `- ${"#".repeat(Number(x.level?.slice(1)) || 2)} ${x.text}`);
  add("");
  add("### Social Meta");
  const social = data.seo?.social || {};
  for (const [k, v] of Object.entries(social.og || {})) add(`- ${k}: ${v || ""}`);
  for (const [k, v] of Object.entries(social.twitter || {})) add(`- ${k}: ${v || ""}`);
  add("");
  add("### Raw Page Structure");
  add(data.structure || "- 未检测到可读结构");
}

function addItemsToLines(lines, items, formatter) {
  if (!items?.length) {
    lines.push("- 未检测到");
    return;
  }
  for (const item of items) lines.push(formatter(item));
}

function buildSectionTree() {
  const root =
    document.querySelector("body > main") ||
    document.querySelector("main") ||
    document.querySelector("[role='main']") ||
    document.body;
  const topLevel = Array.from(document.body?.children || [])
    .filter(isVisibleElement)
    .filter((el) => {
      const tag = el.tagName?.toLowerCase?.() || "";
      return ["header", "nav", "main", "section", "article", "aside", "footer"].includes(tag) || el === root;
    });
  const roots = topLevel.length ? topLevel : [root];
  return roots
    .slice(0, 18)
    .map((el, idx) => buildSectionNode(el, idx, 0))
    .filter(Boolean);
}

function buildSectionNode(el, index, depth) {
  if (!el || !isVisibleElement(el) || depth > 4) return null;
  const tag = el.tagName?.toLowerCase?.() || "node";
  if (["script", "style", "noscript", "svg"].includes(tag)) return null;
  const role = el.getAttribute?.("role") || "";
  const id = el.id || "";
  const classHint = summarizeClassName(el);
  const heading = getSectionHeading(el);
  const label = inferSectionLabel(el, index);
  const rect = summarizeRect(el);
  const layout = getLayoutDescriptor(el);
  const viewport = getViewportDescriptor(el);
  const children = findSectionChildren(el)
    .slice(0, depth === 0 ? 14 : 8)
    .map((child, childIdx) => buildSectionNode(child, childIdx, depth + 1))
    .filter(Boolean);
  const node = {
    tag,
    role,
    id,
    classHint,
    label,
    domPath: getDomPath(el),
    htmlSignature: getHtmlSignature(el),
    rect,
    viewport,
    layout,
    heading,
    purpose: inferSectionPurpose(el, heading),
    componentPattern: inferComponentPattern(el),
    styleSummary: getSectionStyleSummary(el),
    texts: extractDirectReadableTexts(el),
    buttons: extractSectionButtons(el),
    links: extractSectionLinks(el),
    images: extractSectionImages(el),
    forms: extractSectionForms(el),
    tabs: extractSectionTabs(el),
    children
  };
  if (!hasSectionSignal(node)) return null;
  return node;
}

function hasSectionSignal(node) {
  return (
    node.heading ||
    node.texts?.length ||
    node.buttons?.length ||
    node.links?.length ||
    node.images?.length ||
    node.forms?.length ||
    node.tabs?.length ||
    node.children?.length ||
    ["header", "nav", "main", "aside", "footer"].includes(node.tag)
  );
}

function findSectionChildren(el) {
  const selectors = ":scope > header,:scope > nav,:scope > main,:scope > section,:scope > article,:scope > aside,:scope > footer,:scope > div,:scope > form";
  return Array.from(el.querySelectorAll(selectors)).filter((child) => {
    if (!isVisibleElement(child)) return false;
    const text = cleanText(child.innerText || child.textContent || "");
    const hasMedia = child.querySelector?.("img,video,canvas,svg");
    const hasControls = child.querySelector?.("button,a,input,textarea,select,[role='tab'],[role='button']");
    const hasHeading = child.querySelector?.("h1,h2,h3,h4,h5,h6");
    return hasHeading || hasMedia || hasControls || text.length >= 30 || ["header", "nav", "main", "section", "article", "aside", "footer", "form"].includes(child.tagName?.toLowerCase?.());
  });
}

function getSectionHeading(el) {
  if (el.matches?.("h1,h2,h3,h4,h5,h6")) return cleanText(el.textContent || "").slice(0, 180);
  const heading = el.querySelector?.(":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6,h1,h2,h3");
  return cleanText(heading?.textContent || el.getAttribute?.("aria-label") || "").slice(0, 180);
}

function inferSectionLabel(el, index) {
  const tag = el.tagName?.toLowerCase?.() || "section";
  if (tag === "header") return "Header / Top Navigation";
  if (tag === "nav") return "Navigation";
  if (tag === "aside") return "Sidebar / Secondary Navigation";
  if (tag === "footer") return "Footer";
  const hint = safeLower(`${el.id || ""} ${typeof el.className === "string" ? el.className : ""} ${el.getAttribute?.("aria-label") || ""}`);
  if (hint.includes("hero")) return "Hero Section";
  if (hint.includes("pricing")) return "Pricing Section";
  if (hint.includes("faq")) return "FAQ Section";
  if (hint.includes("testimonial") || hint.includes("review")) return "Social Proof Section";
  if (hint.includes("feature")) return "Feature Section";
  if (hint.includes("gallery") || hint.includes("showcase") || hint.includes("example")) return "Examples / Gallery Section";
  return `Section ${index + 1}`;
}

function inferSectionPurpose(el, heading) {
  const haystack = safeLower(`${heading || ""} ${el.id || ""} ${typeof el.className === "string" ? el.className : ""} ${cleanText(el.innerText || "").slice(0, 400)}`);
  if (haystack.includes("hero") || el.querySelector?.("h1")) return "首屏承诺、主标题和主要转化入口";
  if (LANDING_PATTERNS.discount.some((p) => haystack.includes(p))) return "折扣/优惠信息，降低转化阻力";
  if (LANDING_PATTERNS.free.some((p) => haystack.includes(p))) return "免费试用或低门槛开始使用";
  if (LANDING_PATTERNS.examples.some((p) => haystack.includes(p))) return "展示案例、效果或模板，帮助用户判断输出质量";
  if (LANDING_PATTERNS.history.some((p) => haystack.includes(p))) return "生成记录/历史，强调完整生命周期和持续使用";
  if (LANDING_PATTERNS.model.some((p) => haystack.includes(p))) return "模型选择或默认模型，影响用户对能力边界的理解";
  if (haystack.includes("faq")) return "FAQ，处理转化前疑虑";
  if (haystack.includes("pricing") || haystack.includes("price")) return "价格方案，承接购买决策";
  return "";
}

function getSectionStyleSummary(el) {
  const s = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const parts = [
    `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    `display ${s.display}`,
    s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)" ? `bg ${s.backgroundColor}` : "",
    s.color ? `text ${s.color}` : "",
    parseFloat(s.borderRadius) ? `radius ${s.borderRadius}` : "",
    s.boxShadow && s.boxShadow !== "none" ? `shadow ${s.boxShadow}` : "",
    s.padding && s.padding !== "0px" ? `padding ${s.padding}` : "",
    s.gap && s.gap !== "normal" ? `gap ${s.gap}` : ""
  ];
  return parts.filter(Boolean).join(", ");
}

function extractDirectReadableTexts(el) {
  const selectors = ":scope > p,:scope > span,:scope > div,:scope > ul,:scope > ol,:scope > small,:scope > strong,:scope > em";
  const texts = [];
  for (const child of Array.from(el.querySelectorAll(selectors))) {
    if (!isVisibleElement(child)) continue;
    if (child.querySelector?.("section,article,header,footer,aside,nav,form")) continue;
    const text = cleanText(child.innerText || child.textContent || "");
    if (text.length < 2) continue;
    if (texts.some((existing) => existing.includes(text) || text.includes(existing))) continue;
    texts.push(text.slice(0, 260));
    if (texts.length >= 8) break;
  }
  if (!texts.length) {
    const own = getOwnReadableText(el);
    if (own) texts.push(own);
  }
  return texts;
}

function extractSectionButtons(el) {
  return Array.from(el.querySelectorAll(":scope button,:scope [role='button'],:scope a"))
    .filter(isVisibleElement)
    .filter((node) => {
      const text = cleanText(node.innerText || node.textContent || node.getAttribute("aria-label") || "");
      if (!text) return false;
      const tag = node.tagName?.toLowerCase?.();
      const role = node.getAttribute?.("role") || "";
      const classHint = safeLower(`${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`);
      return tag === "button" || role === "button" || LANDING_PATTERNS.free.some((p) => safeLower(`${text} ${classHint}`).includes(p));
    })
    .slice(0, 10)
    .map((node) => ({
      text: cleanText(node.innerText || node.textContent || node.getAttribute("aria-label") || "").slice(0, 120),
      href: node.tagName?.toLowerCase?.() === "a" ? normalizeUrl(node.getAttribute("href") || "", location.href) : "",
      style: getSectionStyleSummary(node)
    }));
}

function extractSectionLinks(el) {
  return Array.from(el.querySelectorAll(":scope a[href]"))
    .filter(isVisibleElement)
    .map((node) => ({
      text: cleanText(node.innerText || node.textContent || node.getAttribute("aria-label") || "").slice(0, 120),
      href: normalizeUrl(node.getAttribute("href") || "", location.href) || ""
    }))
    .filter((x) => x.text && x.href)
    .slice(0, 10);
}

function extractSectionImages(el) {
  return Array.from(el.querySelectorAll(":scope img,:scope picture img"))
    .filter(isVisibleElement)
    .map((img) => ({
      alt: cleanText(img.getAttribute("alt") || "").slice(0, 160),
      src: normalizeUrl(img.currentSrc || img.src || "", location.href) || "",
      size: `${img.naturalWidth || img.width || 0}x${img.naturalHeight || img.height || 0}`,
      style: getSectionStyleSummary(img)
    }))
    .filter((x) => x.src)
    .slice(0, 8);
}

function extractSectionForms(el) {
  return Array.from(el.querySelectorAll(":scope input,:scope textarea,:scope select"))
    .filter(isVisibleElement)
    .slice(0, 10)
    .map((node) => ({
      type: node.getAttribute("type") || node.tagName?.toLowerCase?.() || "input",
      placeholder: cleanText(node.getAttribute("placeholder") || ""),
      label: cleanText(node.getAttribute("aria-label") || node.getAttribute("name") || "")
    }));
}

function extractSectionTabs(el) {
  return Array.from(el.querySelectorAll(":scope [role='tab'],:scope [role='switch'],:scope [aria-selected],:scope button"))
    .filter(isVisibleElement)
    .map((node) => cleanText(node.innerText || node.textContent || node.getAttribute("aria-label") || ""))
    .filter(Boolean)
    .slice(0, 12);
}

function summarizeClassName(el) {
  const raw = typeof el.className === "string" ? el.className : "";
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .filter((x) => !/^(css-|sc-|jsx-|_[a-z0-9]|[a-z0-9]{6,})/i.test(x))
    .slice(0, 8)
    .join(" ");
}

function extractViewportSnapshot(sectionTree = []) {
  const viewport = {
    width: Math.round(window.innerWidth || 0),
    height: Math.round(window.innerHeight || 0),
    scrollX: Math.round(window.scrollX || 0),
    scrollY: Math.round(window.scrollY || 0),
    documentHeight: Math.round(document.documentElement?.scrollHeight || document.body?.scrollHeight || 0),
    documentWidth: Math.round(document.documentElement?.scrollWidth || document.body?.scrollWidth || 0)
  };
  const selector = [
    "header",
    "nav",
    "main",
    "section",
    "article",
    "aside",
    "footer",
    "h1",
    "h2",
    "h3",
    "p",
    "li",
    "a",
    "button",
    "img",
    "figure",
    "figcaption",
    "form",
    "input",
    "textarea",
    "select",
    "video",
    "canvas",
    "[role='button']",
    "[role='tab']",
    "[role='switch']",
    "[aria-label]"
  ].join(",");
  const elements = Array.from(document.querySelectorAll(selector))
    .filter((el) => isVisibleElement(el) && !isIgnoredStructureElement(el))
    .map((el) => summarizeViewportElement(el))
    .filter((item) => item.viewportPosition === "current-viewport")
    .filter((item) => item.text || item.kind !== "layout")
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left || b.priority - a.priority)
    .slice(0, 60)
    .map((item, idx) => ({ ...item, order: idx + 1 }));
  const stickyElements = Array.from(document.querySelectorAll("header,nav,aside,button,a,[role='button'],[aria-label]"))
    .filter((el) => isVisibleElement(el) && !isIgnoredStructureElement(el))
    .filter((el) => {
      const s = window.getComputedStyle(el);
      return s.position === "fixed" || s.position === "sticky";
    })
    .map((el) => summarizeViewportElement(el))
    .filter((item) => item.viewportPosition === "current-viewport")
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    .slice(0, 16)
    .map((item, idx) => ({ ...item, order: idx + 1 }));
  return {
    viewport,
    visibleOrder: elements,
    stickyElements,
    sectionOrder: flattenSectionNodes(sectionTree).slice(0, 80)
  };
}

function summarizeViewportElement(el) {
  const rect = summarizeRect(el);
  const s = window.getComputedStyle(el);
  const viewport = getViewportDescriptor(el);
  return {
    tag: el.tagName?.toLowerCase?.() || "",
    signature: getHtmlSignature(el),
    domPath: getDomPath(el),
    kind: inferElementKind(el),
    text: getElementDisplayText(el, 180),
    rect,
    rectText: rectToText(rect),
    viewportPosition: viewport.position,
    priority: getVisualPriority(el),
    position: s.position,
    zIndex: s.zIndex,
    display: s.display,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    color: s.color,
    backgroundColor: s.backgroundColor
  };
}

function buildComponentInventory({ ctas, navItems, forms, images, pageSwitches, sidebarFeatures, trustSignals, sectionTree }) {
  const sections = flattenSectionNodes(sectionTree)
    .filter((node) => node.componentPattern)
    .slice(0, 24)
    .map((node) => ({
      label: node.heading || node.label || node.htmlSignature,
      detail: [node.componentPattern, node.viewport?.position, node.layout?.summary].filter(Boolean).join(" | ")
    }));
  return {
    groups: [
      {
        name: "Navigation",
        items: (navItems || []).slice(0, 24).map((text) => ({ label: text }))
      },
      {
        name: "CTA / Buttons",
        items: (ctas || []).slice(0, 18).map((item) => ({
          label: item.text || item.label || item.hint || "CTA",
          detail: [item.location, item.href].filter(Boolean).join(" -> ")
        }))
      },
      {
        name: "Tabs / Switches",
        items: (pageSwitches || []).slice(0, 18).map((item) => ({
          label: item.text || item.label || item.hint || "tab",
          detail: item.location || item.tag || ""
        }))
      },
      {
        name: "Forms / Inputs",
        items: (forms || []).slice(0, 18).map((item) => ({
          label: item.text || item.label || item.hint || "input",
          detail: item.location || item.tag || ""
        }))
      },
      {
        name: "Images / Media",
        items: (images || []).slice(0, 18).map((img) => ({
          label: img.alt || "image",
          detail: `${img.width || 0}x${img.height || 0} | ${img.location || ""}`
        }))
      },
      {
        name: "Trust / Proof",
        items: (trustSignals || []).slice(0, 12).map((item) => ({
          label: item.text || item.label || item.hint || "trust signal",
          detail: item.location || item.tag || ""
        }))
      },
      {
        name: "Sidebar Features",
        items: (sidebarFeatures || []).flatMap((sidebar) =>
          (sidebar.items || []).slice(0, 16).map((item) => ({
            label: item,
            detail: sidebar.title || "Sidebar"
          }))
        )
      },
      {
        name: "Section Patterns",
        items: sections
      }
    ]
  };
}

function flattenSectionNodes(sectionTree = []) {
  const out = [];
  const walk = (node, depth = 0) => {
    if (!node) return;
    const { children, ...compact } = node;
    out.push({ ...compact, depth, childCount: (children || []).length });
    for (const child of node.children || []) walk(child, depth + 1);
  };
  for (const node of sectionTree || []) walk(node, 0);
  return out;
}

function buildHtmlSkeletonMarkdown() {
  const lines = ["<body>"];
  let count = 0;
  const roots = Array.from(document.body?.children || [])
    .filter((el) => isVisibleElement(el) && !isIgnoredStructureElement(el))
    .slice(0, 36);
  const walk = (el, depth) => {
    if (!el || count > 340 || depth > 7 || !isVisibleElement(el) || isIgnoredStructureElement(el)) return;
    const tag = el.tagName?.toLowerCase?.() || "node";
    if (["script", "style", "noscript", "template"].includes(tag)) return;
    const children = getSkeletonChildren(el, depth);
    const text = getSkeletonText(el, tag);
    const open = getHtmlOpenTag(el);
    const indent = "  ".repeat(depth);
    count += 1;
    if (isSelfClosingSkeletonTag(tag)) {
      lines.push(`${indent}${open}`);
      return;
    }
    const forceLeaf = isLeafSkeletonTag(tag) && !(tag === "li" && children.length);
    if (!children.length || forceLeaf) {
      lines.push(`${indent}${open}${text ? escapeHtml(text) : ""}</${tag}>`);
      return;
    }
    const layout = getLayoutDescriptor(el);
    const comment = layout.summary ? ` <!-- ${layout.summary}; ${getViewportDescriptor(el).position} -->` : "";
    lines.push(`${indent}${open}${comment}`);
    if (text && !children.some((child) => cleanText(child.innerText || child.textContent || "").includes(text))) {
      lines.push(`${"  ".repeat(depth + 1)}<!-- text: ${escapeHtml(text)} -->`);
    }
    for (const child of children) walk(child, depth + 1);
    lines.push(`${indent}</${tag}>`);
  };
  for (const root of roots) walk(root, 1);
  lines.push("</body>");
  return lines.join("\n");
}

function getSkeletonChildren(el, depth) {
  const semanticTags = new Set([
    "header",
    "nav",
    "main",
    "section",
    "article",
    "aside",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "p",
    "ul",
    "ol",
    "li",
    "a",
    "button",
    "img",
    "picture",
    "figure",
    "figcaption",
    "input",
    "textarea",
    "select",
    "video",
    "canvas"
  ]);
  return Array.from(el.children || [])
    .filter((child) => isVisibleElement(child) && !isIgnoredStructureElement(child))
    .filter((child) => {
      const tag = child.tagName?.toLowerCase?.() || "";
      if (semanticTags.has(tag)) return true;
      const role = child.getAttribute?.("role") || "";
      if (["button", "tab", "switch", "navigation", "main", "complementary"].includes(role)) return true;
      if (depth <= 5 && hasStructuralClassHint(child)) return true;
      if (depth <= 4 && child.querySelector?.("h1,h2,h3,h4,button,a,img,video,canvas,input,textarea,select,[role='tab'],[role='button']")) return true;
      return false;
    })
    .slice(0, depth <= 2 ? 30 : 18);
}

function getSkeletonText(el, tag) {
  if (tag === "img") return cleanText(el.getAttribute("alt") || "").slice(0, 120);
  if (["input", "textarea", "select"].includes(tag)) return cleanText(el.getAttribute("placeholder") || el.getAttribute("aria-label") || "").slice(0, 120);
  if (["h1", "h2", "h3", "h4", "p", "li", "a", "button", "figcaption"].includes(tag)) {
    return getElementDisplayText(el, 180);
  }
  return getOwnReadableText(el).slice(0, 160);
}

function isSelfClosingSkeletonTag(tag) {
  return ["img", "input", "source", "br", "hr", "meta", "link"].includes(tag);
}

function isLeafSkeletonTag(tag) {
  return ["h1", "h2", "h3", "h4", "p", "li", "a", "button", "figcaption", "textarea", "select", "video", "canvas"].includes(tag);
}

function hasStructuralClassHint(el) {
  const hint = safeLower(`${el.id || ""} ${typeof el.className === "string" ? el.className : ""} ${el.getAttribute?.("aria-label") || ""}`);
  return /hero|section|container|wrapper|grid|card|feature|pricing|faq|testimonial|review|gallery|showcase|sidebar|drawer|modal|banner|toolbar|tabs|switch|panel|content|main/i.test(hint);
}

function isIgnoredStructureElement(el) {
  const tag = el.tagName?.toLowerCase?.() || "";
  if (["script", "style", "noscript", "template", "svg"].includes(tag)) return true;
  const hint = safeLower(`${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`);
  return hint.includes("lr-tooltip") || hint.includes("lr-highlight");
}

function buildHtmlStructureMarkdown() {
  const roots = Array.from(document.body?.children || [])
    .filter(isVisibleElement)
    .filter((el) => !isIgnoredStructureElement(el))
    .slice(0, 40);
  const lines = [];
  let count = 0;
  const walk = (el, depth) => {
    if (count > 260 || depth > 5 || !isVisibleElement(el) || isIgnoredStructureElement(el)) return;
    const tag = el.tagName?.toLowerCase?.() || "node";
    const label = cleanText(el.getAttribute?.("aria-label") || "");
    const ownText = getOwnReadableText(el);
    const heading = el.matches?.("h1,h2,h3,h4,h5,h6") ? cleanText(el.textContent || "") : "";
    const img = tag === "img" ? cleanText(el.getAttribute("alt") || el.getAttribute("src") || "") : "";
    const href = tag === "a" ? normalizeUrl(el.getAttribute("href") || "", location.href) : "";
    const content = heading || label || ownText || img;
    if (["script", "style", "noscript", "svg"].includes(tag)) return;
    if (content || ["header", "nav", "main", "section", "article", "aside", "footer", "form"].includes(tag)) {
      const meta = getHtmlSignature(el);
      const suffix = href ? ` (${href})` : "";
      const viewport = getViewportDescriptor(el);
      lines.push(`${"  ".repeat(depth)}- ${meta}${content ? `: ${content.slice(0, 220)}` : ""}${suffix} [${viewport.position}; ${viewport.rectText}]`);
      count += 1;
    }
    const children = Array.from(el.children || [])
      .filter((child) => child.matches?.("header,nav,main,section,article,aside,footer,form,h1,h2,h3,h4,p,ul,ol,li,a,button,img,figure,figcaption,[role='tab'],[role='button']"))
      .slice(0, 24);
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return lines.join("\n");
}

function getOwnReadableText(el) {
  const pieces = [];
  for (const node of Array.from(el.childNodes || [])) {
    if (node.nodeType === Node.TEXT_NODE) pieces.push(node.textContent || "");
  }
  return cleanText(pieces.join(" ")).slice(0, 180);
}

function getElementLocation(el) {
  if (el.closest?.("header,nav,[role='navigation']")) return "top/nav";
  if (el.closest?.("aside,[role='complementary']")) return "sidebar";
  if (el.closest?.("footer")) return "footer";
  if (el.closest?.("main,article,[role='main']")) return "main";
  return "page";
}

function summarizeRect(el) {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    documentY: Math.round(rect.top + (window.scrollY || 0))
  };
}

function rectToText(rect) {
  if (!rect) return "";
  return `${rect.width}x${rect.height} @ ${rect.left},${rect.top}`;
}

function getViewportDescriptor(el) {
  const rect = summarizeRect(el);
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  const inViewport = rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
  const aboveScroll = rect.bottom <= 0;
  const belowFold = rect.top >= vh;
  const offscreenHorizontal = !inViewport && !aboveScroll && !belowFold;
  const position = inViewport ? "current-viewport" : aboveScroll ? "above-scroll" : belowFold ? "below-fold" : offscreenHorizontal ? "offscreen-horizontal" : "unknown";
  return {
    position,
    inViewport,
    aboveFold: rect.top < vh && rect.bottom > 0,
    rectText: rectToText(rect),
    documentY: rect.documentY
  };
}

function getLayoutDescriptor(el) {
  const s = window.getComputedStyle(el);
  const rect = summarizeRect(el);
  const parts = [`${rect.width}x${rect.height}`, s.display];
  if (s.position && s.position !== "static") parts.push(`position ${s.position}`);
  if (s.display.includes("flex")) {
    parts.push(`flex ${s.flexDirection}`);
    if (s.flexWrap && s.flexWrap !== "nowrap") parts.push(`wrap ${s.flexWrap}`);
    if (s.justifyContent) parts.push(`justify ${s.justifyContent}`);
    if (s.alignItems) parts.push(`align ${s.alignItems}`);
  }
  if (s.display.includes("grid")) {
    const columns = countCssTracks(s.gridTemplateColumns);
    parts.push(`grid ${columns || "?"} cols`);
  }
  if (s.gap && s.gap !== "normal" && s.gap !== "0px") parts.push(`gap ${s.gap}`);
  if (s.padding && s.padding !== "0px") parts.push(`padding ${s.padding}`);
  if (s.overflow && s.overflow !== "visible") parts.push(`overflow ${s.overflow}`);
  return {
    summary: parts.filter(Boolean).join(", "),
    display: s.display,
    position: s.position,
    flexDirection: s.flexDirection,
    flexWrap: s.flexWrap,
    justifyContent: s.justifyContent,
    alignItems: s.alignItems,
    gridTemplateColumns: s.gridTemplateColumns,
    gridColumns: countCssTracks(s.gridTemplateColumns),
    gap: s.gap,
    padding: s.padding,
    margin: s.margin,
    overflow: s.overflow
  };
}

function countCssTracks(value) {
  if (!value || value === "none") return 0;
  return value
    .replace(/\([^)]*\)/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

function getDomPath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 9) {
    const tag = node.tagName?.toLowerCase?.() || "node";
    if (tag === "html") break;
    if (tag === "body") {
      parts.unshift("body");
      break;
    }
    let part = tag;
    if (node.id) part += `#${sanitizeSelectorToken(node.id)}`;
    const classTokens = summarizeClassName(node)
      .split(/\s+/)
      .filter(Boolean)
      .map(sanitizeSelectorToken)
      .filter(Boolean)
      .slice(0, 2);
    if (classTokens.length) part += `.${classTokens.join(".")}`;
    const siblings = Array.from(node.parentElement?.children || []).filter((sibling) => sibling.tagName === node.tagName);
    if (siblings.length > 1 && !node.id) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function sanitizeSelectorToken(value) {
  return String(value || "")
    .replace(/[^a-z0-9_-]/gi, "")
    .slice(0, 48);
}

function getHtmlSignature(el) {
  const tag = el.tagName?.toLowerCase?.() || "node";
  const attrs = getReadableHtmlAttrs(el, { includeLinks: false });
  return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
}

function getHtmlOpenTag(el) {
  const tag = el.tagName?.toLowerCase?.() || "node";
  const attrs = getReadableHtmlAttrs(el, { includeLinks: true });
  const suffix = isSelfClosingSkeletonTag(tag) ? " />" : ">";
  return `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}${suffix}`;
}

function getReadableHtmlAttrs(el, { includeLinks }) {
  const tag = el.tagName?.toLowerCase?.() || "";
  const attrs = [];
  const push = (name, value, maxLen = 120) => {
    const clean = cleanText(value || "").slice(0, maxLen);
    if (clean) attrs.push(`${name}="${escapeHtml(clean)}"`);
  };
  push("id", el.id || "", 80);
  push("class", summarizeClassName(el), 160);
  push("role", el.getAttribute?.("role") || "", 60);
  push("aria-label", el.getAttribute?.("aria-label") || "", 120);
  push("type", el.getAttribute?.("type") || "", 60);
  push("placeholder", el.getAttribute?.("placeholder") || "", 120);
  if (includeLinks && tag === "a") push("href", normalizeUrl(el.getAttribute("href") || "", location.href) || "", 220);
  if (includeLinks && tag === "img") {
    push("src", normalizeUrl(el.currentSrc || el.src || "", location.href) || "", 220);
    push("alt", el.getAttribute("alt") || "", 140);
  }
  return attrs;
}

function getElementDisplayText(el, maxLen = 180) {
  const tag = el.tagName?.toLowerCase?.() || "";
  if (tag === "img") return cleanText(el.getAttribute("alt") || el.getAttribute("src") || "").slice(0, maxLen);
  if (["input", "textarea", "select"].includes(tag)) {
    return cleanText(el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.getAttribute("name") || "").slice(0, maxLen);
  }
  const label = cleanText(el.getAttribute?.("aria-label") || el.getAttribute?.("title") || "");
  const own = getOwnReadableText(el);
  const heading = el.matches?.("section,article,main,header,footer,aside,nav,div") ? getSectionHeading(el) : "";
  const text = cleanText(el.innerText || el.textContent || "");
  return (label || own || heading || text).slice(0, maxLen);
}

function inferElementKind(el) {
  const tag = el.tagName?.toLowerCase?.() || "";
  const role = el.getAttribute?.("role") || "";
  if (el.closest?.("header,nav,[role='navigation']") || tag === "nav") return "navigation";
  if (tag === "h1") return "headline";
  if (["h2", "h3", "h4"].includes(tag)) return "section-heading";
  if (tag === "p" || tag === "li") return "copy";
  if (tag === "button" || role === "button") return "button";
  if (tag === "a") return "link";
  if (["img", "picture", "figure", "video", "canvas"].includes(tag)) return "media";
  if (["form", "input", "textarea", "select"].includes(tag)) return "form";
  if (role === "tab" || role === "switch") return "state-control";
  if (["section", "article", "main", "aside", "footer", "header"].includes(tag)) return "layout";
  return "element";
}

function getVisualPriority(el) {
  const tag = el.tagName?.toLowerCase?.() || "";
  if (tag === "h1") return 100;
  if (["button", "a"].includes(tag) || el.getAttribute?.("role") === "button") return 80;
  if (["h2", "h3"].includes(tag)) return 70;
  if (["img", "video", "canvas"].includes(tag)) return 65;
  if (["form", "input", "textarea", "select"].includes(tag)) return 60;
  if (["header", "nav"].includes(tag)) return 55;
  if (["section", "article", "main"].includes(tag)) return 35;
  return 20;
}

function inferComponentPattern(el) {
  const tag = el.tagName?.toLowerCase?.() || "";
  const role = el.getAttribute?.("role") || "";
  const hint = safeLower(`${tag} ${role} ${el.id || ""} ${typeof el.className === "string" ? el.className : ""} ${getSectionHeading(el)} ${getOwnReadableText(el)}`);
  const buttonCount = el.querySelectorAll?.("button,a,[role='button']").length || 0;
  const imageCount = el.querySelectorAll?.("img,picture,video,canvas").length || 0;
  const inputCount = el.querySelectorAll?.("input,textarea,select,form").length || 0;
  const cardCount = el.querySelectorAll?.("[class*='card'],[class*='tile'],[class*='item']").length || 0;
  if (tag === "header" || tag === "nav" || role === "navigation") return "navigation/header";
  if (tag === "aside" || role === "complementary" || hint.includes("sidebar")) return "sidebar/navigation";
  if (hint.includes("hero") || el.querySelector?.("h1")) return "hero";
  if (hint.includes("pricing") || hint.includes("price")) return "pricing";
  if (hint.includes("faq")) return "faq";
  if (hint.includes("testimonial") || hint.includes("review") || LANDING_PATTERNS.trust.some((p) => hint.includes(p))) return "social-proof";
  if (hint.includes("gallery") || hint.includes("showcase") || imageCount >= 4) return "media-gallery";
  if (role === "tab" || hint.includes("tabs") || el.querySelector?.("[role='tab'],[aria-selected]")) return "tabbed-interface";
  if (inputCount) return "form/input";
  if (cardCount >= 3) return "card-grid";
  if (buttonCount >= 3 && imageCount >= 1) return "feature/action cluster";
  if (tag === "footer") return "footer";
  return "";
}

function extractVisualStyle() {
  const sample = (selector) => {
    const el = document.querySelector(selector);
    if (!el || !isVisibleElement(el)) return null;
    const s = window.getComputedStyle(el);
    return {
      selector,
      tag: el.tagName?.toLowerCase?.() || "",
      text: cleanText(el.innerText || el.textContent || el.getAttribute("aria-label") || "").slice(0, 80),
      color: s.color,
      backgroundColor: s.backgroundColor,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      border: s.border,
      borderRadius: s.borderRadius,
      boxShadow: s.boxShadow,
      padding: s.padding,
      margin: s.margin,
      display: s.display,
      gap: s.gap
    };
  };
  const bodyStyle = window.getComputedStyle(document.body);
  const samples = [
    "header",
    "nav",
    "main",
    "h1",
    "h2",
    "p",
    "button",
    "a",
    "input",
    "[role='tab']",
    "aside",
    ".card",
    "[class*='card']",
    "[class*='hero']",
    "[class*='sidebar']"
  ]
    .map(sample)
    .filter(Boolean);
  const typography = samples
    .filter((x) => ["h1", "h2", "p", "button", "a"].includes(x.selector) || x.selector.includes("tab"))
    .slice(0, 10);
  const components = samples
    .filter((x) => ["header", "nav", "button", "input", "aside", ".card", "[class*='card']", "[role='tab']"].includes(x.selector) || x.selector.includes("sidebar"))
    .slice(0, 12);
  const colors = rankStyleColors();
  const maxWidth = getLikelyMaxWidth();
  const overall = inferOverallVisualStyle({ bodyStyle, samples, colors });

  return {
    overall,
    body: {
      color: bodyStyle.color,
      backgroundColor: bodyStyle.backgroundColor,
      fontFamily: bodyStyle.fontFamily,
      fontSize: bodyStyle.fontSize
    },
    layout: {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      maxWidth
    },
    colors,
    typography,
    components
  };
}

function rankStyleColors() {
  const map = new Map();
  const add = (value) => {
    if (!value || value === "rgba(0, 0, 0, 0)" || value === "transparent") return;
    map.set(value, (map.get(value) || 0) + 1);
  };
  const nodes = Array.from(document.querySelectorAll("body,header,nav,main,section,article,aside,footer,h1,h2,h3,p,a,button,input,[class]"))
    .filter(isVisibleElement)
    .slice(0, 500);
  for (const el of nodes) {
    const s = window.getComputedStyle(el);
    add(s.color);
    add(s.backgroundColor);
    add(s.borderColor);
  }
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function getLikelyMaxWidth() {
  const nodes = Array.from(document.querySelectorAll("main,section,article,[class*='container'],[class*='wrapper']"))
    .filter(isVisibleElement)
    .slice(0, 80);
  const widths = nodes.map((el) => Math.round(el.getBoundingClientRect().width)).filter((w) => w > 0);
  if (!widths.length) return "";
  widths.sort((a, b) => b - a);
  return `${widths[0]}px`;
}

function inferOverallVisualStyle({ bodyStyle, samples, colors }) {
  const bg = safeLower(bodyStyle.backgroundColor);
  const text = safeLower(document.body?.innerText || "");
  const hasRadius = samples.some((x) => parseFloat(x.borderRadius) >= 12);
  const hasShadow = samples.some((x) => x.boxShadow && x.boxShadow !== "none");
  const hasSidebar = !!document.querySelector("aside,[class*='sidebar'],[id*='sidebar']");
  const density = (document.querySelectorAll("button,a,input,[role='tab']").length || 0) > 40 ? "功能密集" : "中等密度";
  const tone = bg.includes("255, 255, 255") ? "浅色" : bg.includes("0, 0, 0") || bg.includes("17, 24, 39") ? "深色" : "混合背景";
  const category = text.includes("ai") || text.includes("model") || text.includes("生成") ? "AI 工具/生成类落地页" : "SaaS/产品落地页";
  return [tone, density, category, hasRadius ? "圆角组件" : "", hasShadow ? "带阴影层次" : "", hasSidebar ? "侧边栏功能入口" : ""]
    .filter(Boolean)
    .join("，");
}

function cleanText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function isVisibleElement(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0;
}

function addTooltipHandlers() {
  let tip = null;
  const show = (target, text, meta) => {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "lr-tooltip";
      document.body.appendChild(tip);
    }
    tip.innerHTML = `${escapeHtml(text)}<div class="lr-tip-meta">${escapeHtml(meta)}</div>`;
    const rect = target.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 20, Math.max(10, rect.left));
    const y = Math.min(window.innerHeight - 20, rect.bottom + 10);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.style.display = "block";
  };
  const hide = () => {
    if (tip) tip.style.display = "none";
  };

  const onOver = (e) => {
    const a = e.target?.closest?.("a.lr-highlighted-link");
    if (!a) return;
    const ctx = a.getAttribute("data-lr-context") || "";
    const meta = a.getAttribute("data-lr-meta") || "";
    if (ctx) show(a, ctx, meta);
  };
  const onOut = (e) => {
    const a = e.target?.closest?.("a.lr-highlighted-link");
    if (!a) return;
    hide();
  };

  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("mouseout", onOut, true);
}

function escapeHtml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function enableHighlight(links, settings) {
  injectHighlightCssOnce();
  addTooltipHandlers();
  const pageUrl = location.href;

  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const normalizedSet = new Set(links.map((l) => l.url));
  for (const a of anchors) {
    const rawHref = a.getAttribute("href");
    const normalized = normalizeUrl(rawHref, pageUrl);
    if (!normalized) continue;
    if (!normalizedSet.has(normalized)) continue;
    const locationType = getLinkLocation(a);
    if (settings.hideNoiseByDefault && (locationType === "nav" || locationType === "footer")) continue;

    a.classList.add("lr-highlighted-link");
    const ctx = getContextText(a);
    a.setAttribute("data-lr-context", ctx);
    a.setAttribute("data-lr-meta", `${locationType} | ${getHostname(normalized)}`);
  }
  STATE.highlighted = true;
}

function disableHighlight() {
  for (const a of Array.from(document.querySelectorAll("a.lr-highlighted-link"))) {
    a.classList.remove("lr-highlighted-link");
    a.removeAttribute("data-lr-context");
    a.removeAttribute("data-lr-meta");
  }
  STATE.highlighted = false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "LR_PING") {
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "LR_ANALYZE_PAGE") {
        const analysis = analyzeLinks(msg.settings || {});
        sendResponse(analysis);
        return;
      }
      if (msg?.type === "LR_TOGGLE_HIGHLIGHT") {
        injectHighlightCssOnce();
        if (msg.enabled) enableHighlight(STATE.lastLinks || [], msg.settings || { hideNoiseByDefault: true });
        else disableHighlight();
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: "unknown" });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true;
});
}
