# Lily - Link Radar（V1 可用版）

一个“页面级增长情报”Chrome 插件：一键分析当前页面外链、竞品、商业痕迹与机会评分，并可保存与导出 CSV。

## 1) 安装（无需构建，直接加载目录）

1. 打开 Chrome：`chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录：`link-radar-extension/`

## 2) 使用

1. 打开任意网页
2. 点击浏览器右上角插件图标
3. 点击 **Analyze**
4. 在各区域中查看结果：
   - **Overview**：3 秒看懂页面价值 + 下一步建议
   - **Links**：外链列表（筛选/搜索/展开上下文）
   - **Insights**：3-5 条可解释洞察
   - **SEO**：Title / Description / Canonical / H1 / Issues / SERP / 关键词密度 / 社交分享信息
   - **Save**：保存到本地库 + 标签/状态/备注 + 最近保存
5. 可打开「高亮正文外链」：直接在页面里标出推荐区域
6. 点击 **Export MD**：导出当前页面的 Markdown 拆解，包含落地页转化元素、页面层级、文案、图片与 SEO 信息。

## 3) 设置（V1）

Popup 的 Save Tab 点击 **Settings**，配置：
- 我的产品关键词（用于判断“页面是否漏掉你”）
- 竞品关键词（用于标记外链是否命中竞品）
- 默认只看正文/看全部
- 默认隐藏噪音（nav/footer 等）

## 4) 导出

- 右下角 **Export CSV**：导出“已保存”的页面库。
- 右下角 **Export MD**：导出当前页面关键信息与 HTML 阅读版 Markdown。

## 5) GSC Operator

Side Panel 底部新增 **GSC Operator**：

- **源码版本提示**：侧边栏、Overview 标题旁和 GSC Operator 卡片顶部都会显示 `Source updated` 和扩展版本号。重新加载插件后可以用它确认当前浏览器跑的是不是最新源码。
- **自动提交 URL Inspection**：粘贴 sitemap URL、sitemap XML 或 URL 列表，Lily 会解析并逐个在 Google Search Console 中请求编入索引。
- **抓取核心报告**：请先在当前页签打开正确账号 / Property 的 GSC 报告页；Lily 基于当前页签抓取 Markdown + PNG 截图，不会新开页签。需要抓取多个报告时，可在 Report URLs 多个输入框中分别配置 URL，Lily 会复用当前页签依次跳转。每次抓取会按 `YYYY-MM-DD_HH-mm-ss` 创建独立目录。
- **递归发现 SEO/Growth 报告**：从 GSC Overview 开始时，Lily 会自动补充并递归发现 Search results、Discover、Pages、Videos、Sitemaps、Core Web Vitals、HTTPS、Product snippets、Merchant listings、Breadcrumbs、FAQ、Review snippets、AMP、Links、Manual actions、Security issues 等对 SEO 和商业增长重要的导航、卡片和详情报告。
- **全页截图**：报告截图使用 Chrome 调试协议临时设置较宽的页面截图视口并抓取全页，避免 Side Panel 占用右侧宽度导致 GSC 图表或表格被截窄；调试协议不可用时会自动回退到当前可见页签截图。
- **Core Web Vitals 下钻**：遇到 Core Web Vitals summary 页面时，会复用当前页签依次打开 Mobile / Desktop 的 Open report，抓取 “Why URLs aren't considered good” 问题表，并逐行点击原因进入 URL groups 明细表导出。
- **Page Indexing 下钻**：遇到 Page Indexing 页面时，会抓取 “Why pages aren’t indexed” 原因表，并逐行点击原因进入 drilldown，导出 Examples URL / Last crawled 明细。
- **Performance Insights 下钻**：遇到 Performance Insights 页面时，会抓取 LAST28DAYS 的 Top / Trending up / Trending down，以及 LAST7DAYS 的 Trending down 页面明细，并导出最近 7 天下降页的 Search Analytics page breakdown。
- **通用报告抽取**：对 Discover、Links、Sitemaps、HTTPS、Videos、富结果等未定制下钻的报告，Lily 会抽取关键指标、可见表格、文本快照和页面内发现的 GSC 报告链接，写入单页 Markdown 和总索引。
- **交付文件**：每次 Capture Reports 会生成 `gsc-report-index.md` 总目录、各报告明细 `.md`、结构化 `.json`、截图 `.png`，全部放在同一个 `Downloads/lily-gsc-reports/YYYY-MM-DD_HH-mm-ss/` 目录。所有图片、Markdown 和 JSON 文件都使用报告类型、设备、原因、Tab 等语义化文件名；下载由 background 强制指定文件名，避免 Chrome 把截图落成 `download.png`。`gsc-report-index.md` 会链接全部截图、明细数据文件、默认种子报告和递归发现报告，方便直接反馈给团队。
- **AI 摘要**：Chrome 扩展不能直接启动本地 Node/Next.js 进程；源码里会在 Chrome 启动 / 设置保存时探测 `aiServerUrl` 的 `/api/health`。如果 Settings 中启用了 AI 且服务可用，GSC 报告会额外调用 AI Server 生成优先级摘要并写入 `gsc-report-index.md`。AI Server 可以本地运行，也可以部署到 Vercel 后把 URL 填进 Settings。
- 报告默认下载到：`Downloads/lily-gsc-reports/YYYY-MM-DD_HH-mm-ss/`

说明：Chrome 插件不能静默写入用户 Desktop 任意目录；如果需要固定写桌面目录，需要额外做 Native Messaging 或让用户通过 File System Access API 主动选择目录。插件不会绕过 Google 登录或配额，只在用户已登录 Search Console 的浏览器环境中做低频辅助操作。GSC 报告抓取默认假定当前页签已经打开目标报告，以避免新页签触发多账号切换。

## 6) 说明（V1 范围）

V1 使用规则引擎（本地）：
- 外链提取 + 去重 + URL 归一化（移除 hash/常见追踪参数）
- 链接位置：content/sidebar/nav/footer/comment/unknown（启发式）
- 分类：product/blog/social/affiliate/doc/download/login/register/other
- 商业痕迹：rel=sponsored/ugc、utm/ref/coupon 等信号
- 页面类型：listicle/review/directory/news/other（启发式）
- 机会评分：可解释分数（0-100）
- SEO 与落地页拆解：顶部折扣、免费按钮、标题层级、页面切换、默认模型、案例、生成记录、侧边栏功能、图片、SERP、关键词密度、Open Graph / Twitter

后续如果要接入 AI（例如 Azure OpenAI）做摘要/更精确分类，建议放到 V2（插件仍可在无 AI 环境下工作）。
