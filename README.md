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
4. 在 4 个 Tab 中查看结果：
   - **Overview**：3 秒看懂页面价值 + 下一步建议
   - **Links**：外链列表（筛选/搜索/展开上下文）
   - **Insights**：3-5 条可解释洞察
   - **Save**：保存到本地库 + 标签/状态/备注 + 最近保存
5. 可打开「高亮正文外链」：直接在页面里标出推荐区域

## 3) 设置（V1）

Popup 的 Save Tab 点击 **Settings**，配置：
- 我的产品关键词（用于判断“页面是否漏掉你”）
- 竞品关键词（用于标记外链是否命中竞品）
- 默认只看正文/看全部
- 默认隐藏噪音（nav/footer 等）

## 4) 导出

右下角 **Export CSV**：导出“已保存”的页面库。

## 5) 说明（V1 范围）

V1 使用规则引擎（本地）：
- 外链提取 + 去重 + URL 归一化（移除 hash/常见追踪参数）
- 链接位置：content/sidebar/nav/footer/comment/unknown（启发式）
- 分类：product/blog/social/affiliate/doc/download/login/register/other
- 商业痕迹：rel=sponsored/ugc、utm/ref/coupon 等信号
- 页面类型：listicle/review/directory/news/other（启发式）
- 机会评分：可解释分数（0-100）

后续如果要接入 AI（例如 Azure OpenAI）做摘要/更精确分类，建议放到 V2（插件仍可在无 AI 环境下工作）。

