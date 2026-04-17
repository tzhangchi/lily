import { NOISE_ANCHOR_KEYWORDS, SOCIAL_DOMAINS, TRACKING_QUERY_KEYS, TRACKING_QUERY_PREFIXES } from "./constants.js";

export function safeLower(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

export function normalizeUrl(rawUrl, baseUrl) {
  try {
    const u = new URL(rawUrl, baseUrl);
    if (!(u.protocol === "http:" || u.protocol === "https:")) return null;
    u.hash = "";

    // 删除追踪参数
    const toDelete = [];
    for (const [k] of u.searchParams.entries()) {
      const lk = safeLower(k);
      if (TRACKING_QUERY_KEYS.has(lk)) toDelete.push(k);
      if (TRACKING_QUERY_PREFIXES.some((p) => lk.startsWith(p))) toDelete.push(k);
    }
    toDelete.forEach((k) => u.searchParams.delete(k));

    // 统一尾部斜杠（保留根路径 /）
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);

    return u.toString();
  } catch {
    return null;
  }
}

export function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// V1：简化版“主域名”提取（不含 Public Suffix 列表）
export function getRootDomain(hostname) {
  const parts = (hostname || "").split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

export function isExternalLink(url, pageUrl) {
  try {
    const u = new URL(url);
    const p = new URL(pageUrl);
    return u.hostname && u.hostname !== p.hostname;
  } catch {
    return false;
  }
}

export function extractRelFlags(aEl) {
  const rel = safeLower(aEl.getAttribute("rel"));
  const parts = rel ? rel.split(/\s+/).filter(Boolean) : [];
  const set = new Set(parts);
  return {
    rel: parts,
    isNofollow: set.has("nofollow"),
    isSponsored: set.has("sponsored"),
    isUgc: set.has("ugc")
  };
}

export function looksLikeAffiliate(url) {
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
    if (path.includes("/ref/") || path.includes("/go/") || path.includes("/out/") || path.includes("/recommend/"))
      return true;
    return false;
  } catch {
    return false;
  }
}

export function classifyCategory(url) {
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

    // 粗略判断“产品官网”
    if (path === "/" || path.split("/").filter(Boolean).length <= 1) return "product";
    return "other";
  } catch {
    return "other";
  }
}

export function likelyNoiseLink({ location, anchorText, url }) {
  const a = safeLower(anchorText);
  const u = safeLower(url);
  if (location === "nav" || location === "footer") return true;
  if (NOISE_ANCHOR_KEYWORDS.some((k) => a.includes(k))) return true;
  if (u.includes("privacy") || u.includes("terms") || u.includes("cookie")) return true;
  return false;
}

export function escapeCsvValue(v) {
  const s = (v ?? "").toString();
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function nowIso() {
  return new Date().toISOString();
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

