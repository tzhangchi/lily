# Lily AI Server（Next.js）

这是 **Lily 插件的可选 AI 服务进程**。插件在 **AI 关闭** 或 **服务不可用** 时仍可完全离线运行。

## 1) 安装与运行

```bash
cd ai-server
npm i
npm run dev
```

默认监听：`http://localhost:3000`

健康检查：`http://localhost:3000/api/health`

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
- **AI 服务地址**：`http://localhost:3000`
- **默认模型**：`gpt-4.1` 或 `gpt-5.2`

## 4) 接口

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
