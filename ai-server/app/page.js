export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24, lineHeight: 1.6 }}>
      <h1 style={{ margin: 0 }}>Lily AI Server</h1>
      <p style={{ color: "#555" }}>
        这是 Lily 插件的可选 AI 服务进程（Next.js）。插件会向 <code>/api/analyze</code> 发送页面抽取结果，用 Azure OpenAI
        生成摘要/更精确分类/SEO 建议。
      </p>
      <ul>
        <li>
          健康检查：<code>GET /api/health</code>
        </li>
        <li>
          分析接口：<code>POST /api/analyze</code>
        </li>
      </ul>
    </main>
  );
}

