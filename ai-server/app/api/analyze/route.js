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
        : mode === "gscReportSummary"
          ? await summarizeGscReportWithAzureOpenAI({ endpoint, apiKey, apiVersion, deployment, analysis })
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
    max_tokens: 7200,
    messages: [
      {
        role: "system",
        content:
          "你是一个顶级网页还原 brief 作者、增长设计师和前端结构分析师。你必须只输出 JSON，不允许输出代码块、解释文字或 JSON 之外的内容。"
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

async function summarizeGscReportWithAzureOpenAI({ endpoint, apiKey, apiVersion, deployment, analysis }) {
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const prompt = buildGscReportPrompt(analysis.gscReport || analysis);

  const body = {
    temperature: 0.15,
    max_tokens: 3200,
    messages: [
      {
        role: "system",
        content:
          "你是一个面向增长和技术 SEO 的 GSC 报告分析助手。你必须只输出 JSON，不允许输出代码块、解释文字或 JSON 之外的内容。"
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
  if (!parsed?.markdown) throw new Error("model did not return gsc markdown json");
  return {
    markdown: String(parsed.markdown || "").trim(),
    priorityActions: Array.isArray(parsed.priorityActions) ? parsed.priorityActions.slice(0, 12) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 12) : []
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
    viewportSnapshot: pageBrief.viewportSnapshot || {},
    componentInventory: pageBrief.componentInventory || {},
    htmlSkeleton: String(pageBrief.htmlSkeleton || "").slice(0, 22000),
    structure: String(pageBrief.structure || "").slice(0, 18000)
  };

  return [
    "请把网页抽取结果整理成一份高质量 Markdown 复刻 brief。核心任务不是 SEO 报告，而是基于当前打开网页的所见即所得画面、HTML 层级和 DOM/sectionTree，从上到下还原页面。",
    "",
    "目标：这份 Markdown 要能让另一个 AI 或前端工程师尽可能复刻页面的“首屏视觉顺序 + 页面顺序 + HTML 语义结构 + Section 布局 + 文字 + 按钮 + 图片 + 组件 + 视觉细节”。",
    "必须优先使用 viewportSnapshot、sectionTree、htmlSkeleton。viewportSnapshot 表示当前打开页面视口中真实可见元素的顺序；sectionTree 是 DOM 抽出来的可读结构；htmlSkeleton 是更接近 HTML 还原的层级骨架。",
    "不要只是罗列原始数据。请把 HTML 树转译成可执行页面蓝图：每个 Section 是什么、在视觉上位于哪里、为什么存在、里面有什么文字、按钮、链接、图、tab、输入框、侧边栏、视觉样式，以及复刻时应写成怎样的 HTML 结构。",
    "",
    "必须包含这些章节，顺序固定：",
    "1. Page Snapshot",
    "2. Above-the-fold WYSIWYG Summary",
    "3. Page Reconstruction Tree",
    "4. Section-by-section Blueprint",
    "5. HTML Structure Skeleton",
    "6. Visual Style System",
    "7. Component Inventory",
    "8. Conversion Architecture",
    "9. SEO Extract",
    "10. Images And Media",
    "11. Replication Prompt",
    "12. Issues And Opportunities",
    "13. Raw Evidence Appendix",
    "",
    "写作要求：",
    "- 中文为主，保留页面原英文文案。",
    "- Above-the-fold WYSIWYG Summary 必须按 viewportSnapshot 的 visual order 描述当前屏幕从上到下看到的元素、文案、按钮、图片、固定导航和视觉重心。",
    "- Page Reconstruction Tree 必须用树形 Markdown 展示页面从上到下的层级，至少保留 Header/Main/每个 Section/Footer，并保留 DOM/HTML signature、视觉位置和布局信息。",
    "- Section-by-section Blueprint 必须按页面出现顺序逐段写，每段包含：Section 名称、目的、HTML 语义标签建议、布局、视觉样式、完整可见文案、按钮/链接、图片/媒体、交互状态、复刻注意点。",
    "- HTML Structure Skeleton 必须基于 htmlSkeleton/sectionTree 输出接近真实网页的 HTML 层级代码块，表达 header/nav/main/section/article/aside/footer、主要 div 容器、h/p/a/button/img/form/tab/list/card 的嵌套关系。",
    "- 如果一个 section 有子节点或卡片网格，要用嵌套 bullet 展开，不能压缩成一句话。",
    "- 对按钮文案要逐字保留；对标题、副标题、折扣条、tab 名、默认模型、案例标题、生成记录、侧边栏功能要重点保留。",
    "- 对标题、CTA、折扣、tab、默认模型、案例、生成记录、侧边栏功能要重点解释。",
    "- Visual Style System 要总结颜色、字体、按钮、卡片、布局宽度、圆角、阴影、密度、整体气质。",
    "- Component Inventory 要按 nav、CTA、tab/switch、form/input、card/grid、image/media、sidebar、trust proof 归类。",
    "- Replication Prompt 要写成可直接喂给生成页面 AI 的指令，要求按 Section 顺序实现，并明确 HTML 结构、布局和视觉样式。",
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
    "【页面所见即所得、HTML 层级与视觉证据】",
    JSON.stringify(compactBrief, null, 2).slice(0, 52000),
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

function buildGscReportPrompt(report) {
  const compact = JSON.stringify(report, null, 2).slice(0, 52000);
  return [
    "请基于 Google Search Console 抓取结果，输出一份面向 llamagen.ai 团队的优先级优化摘要。",
    "",
    "必须分析这些维度（如果数据存在）：",
    "- Core Web Vitals：Mobile/Desktop 的 Poor / Need improvement issue，URL groups，影响 URL 数。",
    "- Page Indexing：Why pages aren't indexed 的原因、Pages 数、Examples URL 和 Last crawled。",
    "- Performance Insights：Top、Trending up、Trending down，尤其最近 7 天下降页面和 Search Analytics page breakdown。",
    "- 其他 SEO/Growth 报告：Search results、Discover、Videos、Sitemaps、HTTPS、Links、Product snippets、Merchant listings、Breadcrumbs、FAQ、Review snippets、AMP、Manual actions、Security issues。",
    "- 通用表格和发现链接：从 tables、metrics、discoveredReports 中识别商业增长、索引覆盖、富结果资格、站点体验和风险信号。",
    "",
    "输出要求：",
    "- 中文为主，保留原始英文 issue/reason/page URL。",
    "- 按优先级排序，明确哪些问题最影响增长。",
    "- 对每个行动建议写：问题、影响、证据、建议动作、负责人建议（SEO/前端/内容/后端）、优先级。",
    "- 不要编造报告里没有的数值；如果数值缺失，写“报告未提供”。",
    "",
    "你必须输出 JSON：",
    JSON.stringify(
      {
        markdown: "完整 Markdown 摘要，含 Executive Summary、Priority Actions、Evidence、Next Checks",
        priorityActions: ["最高优先级行动列表"],
        risks: ["需要注意的数据/抓取风险"]
      },
      null,
      2
    ),
    "",
    "【GSC 报告 JSON（可能截断）】",
    compact,
    "",
    "强约束：只输出 JSON。"
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
