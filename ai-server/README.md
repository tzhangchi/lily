# Lily AI Server（Next.js）

这是 **Lily 插件的可选 AI 服务进程**。插件在 **AI 关闭** 或 **服务不可用** 时仍可完全离线运行。

## 1) 安装与运行

```bash
cd ai-server
npm i
npm run dev
```

默认监听：`http://localhost:3100`

健康检查：`http://localhost:3100/api/health`

## 2) 环境变量（Azure OpenAI）

创建 `.env.local`（不要提交到 git）：

```bash
AZURE_OPENAI_AZURE_ENDPOINT="https://xxxx.openai.azure.com"
AZURE_OPENAI_API_KEY="xxxxxxxx"

# 可选：API 版本（全局默认）
AZURE_OPENAI_API_VERSION="2024-12-01-preview"

# 可选：按 model 单独覆盖 API 版本（优先级高于全局）
# AZURE_OPENAI_API_VERSION_GPT_4_1="2024-12-01-preview"
# AZURE_OPENAI_API_VERSION_GPT_5_2="2024-12-01-preview"
```

> 兼容：如果你之前写成了 `AZURE_OPENAI_AZURE_ENDPOINTI`（末尾多了 I），服务端也会读取。

## 3) 插件侧配置

打开插件 Settings：

- **启用 AI**：是
- **AI 服务地址**：`http://localhost:3100`
- **默认模型**：`gpt-4.1` 或 `gpt-5.2`

Chrome 扩展不能直接启动本地 Node/Next.js 进程；它只会在 Chrome 启动或保存设置时探测 `/api/health`，并在 AI 可用时调用本服务。生产环境可以把本目录部署到 Vercel，然后把 Vercel URL 配到插件 Settings 的 **AI 服务地址**。

## 4) GSC 报告 AI 摘要

GSC Operator 抓取报告时会在 AI 已启用且服务可用的情况下调用：

```json
{
  "mode": "gscReportSummary",
  "model": "gpt-4.1",
  "analysis": {
    "url": "https://search.google.com/...",
    "title": "Google Search Console report",
    "domain": "llamagen.ai",
    "gscReport": { "...": "插件抓取的 GSC 结构化数据" }
  }
}
```

返回的 `ai.markdown` 会写入 `gsc-report-index.md`。

插件现在会把递归发现到的 Search results、Discover、Indexing、Videos、Sitemaps、Core Web Vitals、HTTPS、Links、富结果、Manual actions、Security issues 等报告，以及通用表格抽取结果一并传给 AI 摘要，方便按 SEO / Growth 优先级排序。

## 5) 接口

`POST /api/analyze`

请求体：

```json
{
  "model": "gpt-4.1",
  "analysis": { "...": "插件抽取结果（已在 background 中做 slim）" }
}
```

返回：

```json
{ "ok": true, "ai": { "summary": "...", "conversionChecklist": [] } }
```
