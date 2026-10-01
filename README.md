# dsh-inline-figures

DSH 宿主插件：让模型在回复正文里穿插矢量解释图（WorkBuddy 式图文穿插）。

```
模型调 draw_figure → 手写 SVG(raw_svg，主路径) 或 4 型 JSON 规格(兜底) → 消毒/布局引擎产出 SVG
→ 写入 <workspace>/.dsh-figures/<会话>/N-slug.svg → 模型把返回的 ![alt](path) 原样嵌入正文
→ DSH 原生 Markdown 图片渲染（满宽、不折叠、点击放大）
```

## 特性

- **SVG 优先**：主路径是模型手写 `raw_svg`（任意结构：树、分支流水线、状态图、自定义），消毒器注入主题样式 + 箭头 marker，保证满宽与明暗自适应；`architecture`/`compare`/`timeline`/`chart` 四型 JSON 规格为兜底（标准形/数值图用布局引擎确定性排版，永不手写坐标）。**永不用 ASCII/Unicode 字符画**。
- **四型排版引擎**：`architecture`（分层 + P0/P1 徽章 + danger 分组框 + 反馈边）、`compare`（左右对照 + 语义色）、`timeline`（步骤流 done/active/todo）、`chart`（bar/line/pie + 轴刻度 + 标签自动旋转）。
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

```powershell
pwsh -File packages/dsh-inline-figures/scripts/install-to-profile.ps1            # 默认 desktop profile
pwsh -File packages/dsh-inline-figures/scripts/install-to-profile.ps1 -Profile web
```

需要联网（按运行时精确锁定的 `@deepseek-ai/*` 依赖从 npm 拉取）。完成后**重启 DSH 应用**，Settings → 内置插件 → inline-figures 应显示"运行中"。

为什么不是简单的 `link:` 安装：宿主 Node 进程对外部 bundle 的 `@deepseek-ai/*` import 走原生解析，而这些包在 app 的 asar 内、link 真实路径的解析链上不可见；且 pnpm 对指向工作区的 `file:` 依赖在移除时会顺着 junction 误删源目录（本包实测发生过，git 可恢复）。因此脚本走"临时副本 → file: 安装 → 安装目录内补齐依赖闭包 → 加载探针"流程。DSH 运行时升级后，把 `package.json` 里的精确依赖版本改成 app 内置版本再重跑脚本。

本机现状（desktop profile）已按此装好并加载验证通过，等待宿主重启后生效。

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
