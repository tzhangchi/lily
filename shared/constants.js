export const DEFAULT_SETTINGS = {
  myProductKeywords: ["LlamaGen"],
  competitorKeywords: ["Midjourney", "Runway", "Kling", "Dashtoon"],
  hideNoiseByDefault: true,
  defaultScope: "content", // all | content
  highlightEnabled: false,

  // AI（可选）：默认关闭，插件在无 AI 环境下照常工作
  aiEnabled: false,
  aiServerUrl: "http://localhost:3100", // Next.js 服务进程地址
  aiModel: "gpt-4.1" // 支持：gpt-4.1 / gpt-5.2（按服务端部署名映射）
};

// 常见“追踪/投放”参数：V1 规则版（可扩展）
export const TRACKING_QUERY_PREFIXES = ["utm_"];
export const TRACKING_QUERY_KEYS = new Set([
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

export const SOCIAL_DOMAINS = new Set([
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

export const NOISE_ANCHOR_KEYWORDS = [
  "privacy",
  "terms",
  "login",
  "sign in",
  "signup",
  "sign up",
  "register",
  "cookie",
  "policy"
];
