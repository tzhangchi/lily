export const runtime = "nodejs";

// 你给的示例使用 2024-12-01-preview，这里作为默认值（也可按 model 单独覆盖）
const DEFAULT_API_VERSION = "2024-12-01-preview";

function getEnvEndpoint() {
  // 兼容你给的变量名（末尾多了 I）
  const raw = process.env.AZURE_OPENAI_AZURE_ENDPOINT || process.env.AZURE_OPENAI_AZURE_ENDPOINTI || "";
  return raw.replace(/\/+$/, "");
}

function modelToEnvKey(model) {
  return `AZURE_OPENAI_DEPLOYMENT_${String(model).replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`;
}

function apiVersionToEnvKey(model) {
  return `AZURE_OPENAI_API_VERSION_${String(model).replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`;
}

function corsHeaders() {
  // 允许 chrome-extension:// 发起请求（开发阶段直接放开）
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req) {
  try {
    const { analysis, model, mode } = await req.json();
    if (!analysis?.url) return Response.json({ ok: false, error: "missing analysis" }, { status: 400, headers: corsHeaders() });

    const endpoint = getEnvEndpoint();
    const apiKey = process.env.AZURE_OPENAI_API_KEY || "";
    const modelName = model || "gpt-4.1";
    const apiVersion =
      process.env[apiVersionToEnvKey(modelName)] || process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION;

    if (!endpoint) return Response.json({ ok: false, error: "missing AZURE_OPENAI_AZURE_ENDPOINT" }, { status: 500, headers: corsHeaders() });
    if (!apiKey) return Response.json({ ok: false, error: "missing AZURE_OPENAI_API_KEY" }, { status: 500, headers: corsHeaders() });

    const deployment =
      process.env[modelToEnvKey(modelName)] ||
      process.env.AZURE_OPENAI_DEPLOYMENT ||
      modelName; // 默认：假设 deployment 名字就叫 gpt-4.1 / gpt-5.2

    const ai =
      mode === "markdownExport"
        ? await exportMarkdownWithAzureOpenAI({ endpoint, apiKey, apiVersion, deployment, analysis })
        : await enhanceWithAzureOpenAI({ endpoint, apiKey, apiVersion, deployment, analysis });

    return Response.json({ ok: true, ai }, { headers: corsHeaders() });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500, headers: corsHeaders() });
  }
}

async function enhanceWithAzureOpenAI({ endpoint, apiKey, apiVersion, deployment, analysis }) {
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const prompt = buildPrompt(analysis);

  const body = {
    temperature: 0.2,
    max_tokens: 900,
    messages: [
      {
        role: "system",
        content:
          "你是一个专注 SEO/落地页优化的增长分析助手。你必须只输出 JSON（不允许输出 markdown、解释文字或代码块）。"
      },
      { role: "user", content: prompt }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`azure openai http ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(content);
  if (!parsed) throw new Error("model did not return valid json");
  return normalizeAi(parsed);
}

async function exportMarkdownWithAzureOpenAI({ endpoint, apiKey, apiVersion, deployment, analysis }) {
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const prompt = buildMarkdownPrompt(analysis);

  const body = {
    temperature: 0.15,
    max_tokens: 5200,
    messages: [
      {
        role: "system",
        content:
          "你是一个顶级增长设计师、SEO 专家和前端复刻 brief 作者。你必须只输出 JSON，不允许输出代码块、解释文字或 JSON 之外的内容。"
      },
      { role: "user", content: prompt }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`azure openai http ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(content);
  if (!parsed?.markdown) throw new Error("model did not return markdown json");
  return {
    markdown: String(parsed.markdown || "").trim(),
    notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 8) : []
  };
}

function buildPrompt(a) {
  const seo = a.seo || {};
  const topLinks = (a.links || []).slice(0, 30);
  return [
    "输入是一个网页（通常是落地页/测评页/榜单页/目录页）的抽取结果，请你做：摘要 + 更精确分类 + SEO 建议 + 转化要素检查。",
    "",
    "【页面信息】",
    `URL: ${a.url}`,
    `Title: ${a.title || ""}`,
    `Description: ${seo.description || ""}`,
    `Canonical: ${seo.canonical || ""}`,
    `H1: ${(seo.h1 || []).join(" | ")}`,
    `WordCount(en): ${seo.wordCount ?? ""}, ZhCharCount: ${seo.zhCharCount ?? ""}`,
    `TopKeywordCandidates (rule-based): ${(seo.keywordDensity?.top || []).slice(0, 8).map((k) => `${k.term}(${k.count})`).join(", ")}`,
    "",
    "【正文文本样本（可能截断）】",
    (a.textSample || "").slice(0, 12000),
    "",
    "【外链样本（最多 30 条）】",
    JSON.stringify(
      topLinks.map((l) => ({
        url: l.url,
        domain: l.domain,
        anchorText: l.anchorText,
        location: l.location,
        category: l.category,
        isCompetitor: l.isCompetitor,
        isSponsored: l.isSponsored,
        isNofollow: l.isNofollow
      })),
      null,
      2
    ),
    "",
    "你必须输出一个 JSON 对象，字段结构如下（可增字段但不要删字段）：",
    JSON.stringify(
      {
        summary: "一句话总结（中文）",
        insights: ["3-5 条洞察（中文）"],
        pageType: "landing | listicle | review | directory | docs | other",
        primaryKeyword: "你认为最重要的主关键词（中文或英文）",
        h1Suggestion: "建议的 H1（围绕主关键词，且仅 1 个）",
        seoSuggestions: {
          improvedTitle: "建议的 Title（30-60 字符左右）",
          improvedDescription: "建议的 Description（70-160 字符左右）",
          issues: ["按优先级列出问题（可复用/补充 rule-based issues）"]
        },
        linkRefine: {
          note: "对链接分类的总体判断（中文）",
          overrides: [{ url: "https://example.com", category: "product|blog|social|affiliate|ad|doc|download|login|register|other", reason: "一句话原因" }]
        },
        conversionChecklist: ["结合“投放花钱的落地页”经验，列出本页缺失/可优化的关键要素（中文，8-12 条以内）"],
        serpQueries: ["建议去 Google 搜索的 query（中英文混合都行，3-6 条）"]
      },
      null,
      2
    ),
    "",
    "强约束：只输出 JSON，不能有多余文字。"
  ].join("\n");
}

function buildMarkdownPrompt(a) {
  const seo = a.seo || {};
  const pageBrief = a.pageBrief || {};
  const visualStyle = pageBrief.visualStyle || {};
  const topLinks = (a.links || []).slice(0, 30);
  const compactBrief = {
    highlights: pageBrief.highlights || [],
    discountBanners: pageBrief.discountBanners || [],
    freeButtons: pageBrief.freeButtons || [],
    ctas: pageBrief.ctas || [],
    headings: pageBrief.headings || [],
    pageSwitches: pageBrief.pageSwitches || [],
    defaultModels: pageBrief.defaultModels || [],
    examples: pageBrief.examples || [],
    generationHistory: pageBrief.generationHistory || [],
    sidebarFeatures: pageBrief.sidebarFeatures || [],
    navItems: pageBrief.navItems || [],
    forms: pageBrief.forms || [],
    trustSignals: pageBrief.trustSignals || [],
    images: pageBrief.images || [],
    visualStyle,
    sectionTree: pageBrief.sectionTree || [],
    structure: String(pageBrief.structure || "").slice(0, 18000)
  };

  return [
    "请把网页抽取结果整理成一份高质量 Markdown。核心任务不是 SEO 报告，而是基于 HTML 树理解页面，从上到下还原每个 Section。",
    "",
    "目标：这份 Markdown 要能让另一个 AI 或前端工程师尽可能复刻页面的“页面顺序 + Section 布局 + 文字 + 按钮 + 图片 + 组件 + 视觉细节”。",
    "必须优先使用 sectionTree。sectionTree 是从 HTML/DOM 抽出来的树形结构，请按它的顺序理解页面，而不是把 SEO 信息放在最前面泛泛分析。",
    "不要只是罗列原始数据。请你把 HTML 树转译成可读的页面蓝图：每个 Section 是什么、为什么存在、里面有什么文字、按钮、链接、图、tab、输入框、侧边栏、视觉样式。",
    "",
    "必须包含这些章节，顺序固定：",
    "1. Page Snapshot",
    "2. Page Reconstruction Tree",
    "3. Section-by-section Blueprint",
    "4. Visual Style System",
    "5. Component Inventory",
    "6. Conversion Architecture",
    "7. SEO Extract",
    "8. Images And Media",
    "9. Replication Prompt",
    "10. Issues And Opportunities",
    "11. Raw Evidence Appendix",
    "",
    "写作要求：",
    "- 中文为主，保留页面原英文文案。",
    "- Page Reconstruction Tree 必须用树形 Markdown 展示页面从上到下的层级，至少保留 Header/Main/每个 Section/Footer。",
    "- Section-by-section Blueprint 必须按页面出现顺序逐段写，每段包含：Section 名称、目的、布局、视觉样式、完整可见文案、按钮/链接、图片/媒体、交互状态、复刻注意点。",
    "- 如果一个 section 有子节点或卡片网格，要用嵌套 bullet 展开，不能压缩成一句话。",
    "- 对按钮文案要逐字保留；对标题、副标题、折扣条、tab 名、默认模型、案例标题、生成记录、侧边栏功能要重点保留。",
    "- 对标题、CTA、折扣、tab、默认模型、案例、生成记录、侧边栏功能要重点解释。",
    "- Visual Style System 要总结颜色、字体、按钮、卡片、布局宽度、圆角、阴影、密度、整体气质。",
    "- Replication Prompt 要写成可直接喂给生成页面 AI 的指令，要求按 Section 顺序实现。",
    "- Raw Evidence Appendix 只放必要证据，避免把所有噪音塞进去。",
    "- 如果无法确定，写“未检测到”或“推断：...”，不要编造具体数值。",
    "- SEO Extract 要保留 Title、Description、Canonical、H1、关键词密度和 issues，但不要让 SEO 淹没页面还原。",
    "",
    "你必须输出 JSON：",
    JSON.stringify({ markdown: "完整 Markdown 字符串", notes: ["可选：导出质量备注"] }, null, 2),
    "",
    "【页面基础信息】",
    JSON.stringify(
      {
        url: a.url,
        title: a.title,
        domain: a.domain,
        pageType: a.pageType,
        score: a.score,
        summary: a.summary,
        insights: a.insights,
        ai: a.ai || null
      },
      null,
      2
    ),
    "",
    "【SEO】",
    JSON.stringify(
      {
        title: seo.title,
        description: seo.description,
        canonical: seo.canonical,
        h1: seo.h1,
        wordCount: seo.wordCount,
        zhCharCount: seo.zhCharCount,
        keywordDensity: seo.keywordDensity,
        serp: seo.serp,
        social: seo.social,
        issues: seo.issues
      },
      null,
      2
    ),
    "",
    "【落地页与视觉证据】",
    JSON.stringify(compactBrief, null, 2).slice(0, 36000),
    "",
    "【正文文本样本】",
    String(a.textSample || "").slice(0, 12000),
    "",
    "【外链样本】",
    JSON.stringify(
      topLinks.map((l) => ({
        url: l.url,
        domain: l.domain,
        anchorText: l.anchorText,
        location: l.location,
        category: l.category,
        isCompetitor: l.isCompetitor,
        isSponsored: l.isSponsored,
        isNofollow: l.isNofollow,
        contextText: l.contextText
      })),
      null,
      2
    ),
    "",
    "强约束：只输出 JSON。JSON 里的 markdown 字段可以包含 Markdown 文本。"
  ].join("\n");
}

function safeJsonParse(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {}
  // 兼容模型偶尔包裹一些前后文本：尝试抓第一个 {...} 块
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function normalizeAi(ai) {
  return {
    summary: ai.summary || "",
    insights: Array.isArray(ai.insights) ? ai.insights.slice(0, 6) : [],
    pageType: ai.pageType || "",
    primaryKeyword: ai.primaryKeyword || "",
    h1Suggestion: ai.h1Suggestion || "",
    seoSuggestions: ai.seoSuggestions || {},
    linkRefine: ai.linkRefine || {},
    conversionChecklist: Array.isArray(ai.conversionChecklist) ? ai.conversionChecklist.slice(0, 12) : [],
    serpQueries: Array.isArray(ai.serpQueries) ? ai.serpQueries.slice(0, 8) : []
  };
}
