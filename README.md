# dsh-inline-figures

DSH 宿主插件：让模型在回复正文里穿插矢量解释图（WorkBuddy 式图文穿插）。

```
模型调 draw_figure(JSON 图型规格) → 布局引擎确定性生成 SVG → 写入 <workspace>/.dsh-figures/<会话>/N-slug.svg
→ 模型把返回的 ![alt](path) 原样嵌入正文 → DSH 原生 Markdown 图片渲染（满宽、不折叠、点击放大）
```

## 特性

- **5 种图型**：`architecture`（分层架构 + P0/P1 徽章 + danger 分组框 + 反馈边）、`compare`（左右对照 + 语义色）、`timeline`（步骤流 done/active/todo）、`chart`（bar/line/pie + 轴刻度 + 标签自动旋转）、`raw_svg` 逃生口（字符串级消毒）。
- **满宽渲染**：viewBox 680 排版、固有宽 1600，浏览器等比缩放到内容列宽；矢量无损耗。
- **明暗自适应**：SVG 内嵌 `@media (prefers-color-scheme)` 双色板（跟随系统主题，见"已知局限"）。
- **开关**：Settings 插件表单 `enabled`（volatile，改完新会话生效）；关闭后工具与系统提示引导同时消失。
- **卫生**：`.dsh-figures/.gitignore`（内容 `*`，产物不进 git）、每会话目录 200 文件 LRU 清理、标签截断以 warnings 回报模型。

## 开发

```powershell
cd packages/dsh-inline-figures
node --test                      # 全部测试（零依赖，node:test）
$env:UPDATE_GOLDEN='1'; node --test test/architecture.test.js   # 重新生成布局快照（目检后提交）
```

## 安装到本地 DSH

在 DSH 会话中（或 Plugins 页选本地路径）：

```
plugin_manager action=install_bundle target=link:C:\<绝对路径>\packages\dsh-inline-figures
```

## 非 DSH 宿主复用（自有 web 软件三件套）

`lib/` 全部零 `@deepseek-ai` 依赖（有强制测试），包暴露 `./engine` 入口：

```js
import { drawFigure, validateSpec, sanitizeSvg, GUIDANCE_TEXT } from '@local/dsh-inline-figures/engine'
const { svg, warnings } = drawFigure({ kind: 'compare', title: '…', rows: [ … ] })
// 1) 工具注册：在你的 agent 后端注册同 schema 工具，execute 里调 drawFigure
// 2) 提示词：GUIDANCE_TEXT 直接贴进你的系统提示（含工具用法与穿插规则）
// 3) 渲染：svg 字符串直接内联或存文件走你前端的 markdown 图片通道
```

## 已知局限

1. 主题经 `prefers-color-scheme` 跟随**系统**主题；若你的应用内主题与系统相反，图与界面色调会拧（彻底解法需客户端插件配合，规划中）。
2. 桌面壳 `dsh-app:` 页面对认证文件路由支持存疑；本插件按 Web GUI（http）设计并已验证。
3. 文本宽度为近似测量（CJK 1em / 拉丁 0.55em），极端长词会截断加 `…` 并回报 warning。
4. 图静态、不可交互（设计决策）。
