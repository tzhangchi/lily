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
    contentLinks,
    competitorMentions,
    commercialSignals,
    summary,
    insights,
    seo,
    textSample,
    analyzedAt: new Date().toISOString(),
    links
  };
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
