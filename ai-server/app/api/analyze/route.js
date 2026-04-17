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
    const { analysis, model } = await req.json();
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

    const ai = await enhanceWithAzureOpenAI({ endpoint, apiKey, apiVersion, deployment, analysis });

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
