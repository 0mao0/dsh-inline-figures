# dsh-inline-figures

DSH 宿主插件：让模型在回复正文里穿插矢量解释图（WorkBuddy 式图文穿插）。

```
模型调 draw_figure → 手写 SVG(raw_svg，主路径) 或 4 型 JSON 规格(兜底) → 消毒/布局引擎产出 SVG
→ 写入 <workspace>/.dsh-figures/<会话>/N-slug.svg → 模型把返回的 ![alt](path) 原样嵌入正文
→ DSH 原生 Markdown 图片渲染（满宽、不折叠、点击放大）
```

## 特性

- **判断式出图（非仪式）**：模型顺着回答写，在"这里用图比用话更快更清楚"的那个点才插图——不先出图、不摊配额；多数回答 0–2 张、常为 0；散文已够清楚（一句话查询/定义/单值/纯代码）就不画。判据是**比较性**的，不是"命中结构就画"。图内标签与图旁 caption 用 ASD-STE100 式受控语言（短句、一词一义、主动语态、名词短语标签），图外正文保持自然中文。
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

**全程离线**：脚本从 app 解包树（默认 `_probe/dshtree/dsh/node_modules`，可用 `-Tree` 指定）计算依赖闭包（`build-offline-closure.mjs`，32 包），实体化进安装目录与持久 staging（`~/.dsh/vendor`），然后手写回 profile manifest 并用宿主同款解析做加载探针。完成后**重启 DSH 应用**，Settings → 内置插件 → inline-figures 应显示"运行中"。

为什么这么绕（全部本机实测踩过）：① 宿主 Node 对外部 bundle 的 `@deepseek-ai/*` import 走原生解析，asar 内的包在其解析链上不可见 → 闭包必须随 bundle 实体安装；② pnpm 会把 profile 顶层"未声明"的 node_modules 条目当冗余剪掉 → 闭包必须放在**安装目录内部**（自包含，已用改名探针验证）；③ `dsh plugin add`（pnpm）走 registry，网络不稳时中途失败会**回滚 manifest**、把 bundle 整个注销 → 改手动放置+manifest 注册，cordis 加载只认 manifest 与 node_modules 实体；④ `file:` 指工作区时 pnpm 移除依赖会顺 junction 毁源目录（发生过，git 救回）→ staging 用持久副本 `~/.dsh/vendor`。DSH 运行时升级后：重新解包 app 树、重跑脚本即可（闭包自动跟版本）。

## 非 DSH 宿主复用（自有 web 软件三件套）

`lib/` 全部零 `@deepseek-ai` 依赖（有强制测试），包暴露 `./engine` 入口：

```js
import { drawFigure, validateSpec, sanitizeSvg, GUIDANCE_TEXT } from '@local/dsh-inline-figures/engine'
const { svg, warnings } = drawFigure({ kind: 'compare', title: '…', rows: [ … ] })
// 1) 工具注册：在你的 agent 后端注册同 schema 工具，execute 里调 drawFigure
// 2) 提示词：GUIDANCE_TEXT 直接贴进你的系统提示（含工具用法与穿插规则）
// 3) 渲染：svg 字符串直接内联或存文件走你前端的 markdown 图片通道
```

## 宿主工具 schema 契约（踩过的坑，勿回退）

`defineTool` 的 schema 编译器（dsh-tools）有两条硬规则，违反时插件**"启动失败"或每次调用报 `invalid arguments`**：

1. **每个 `type:'object'` 节点**（顶层与所有嵌套）必须显式写 `additionalProperties: true|false`，否则 `defineTool` 在注册时抛错（→ Settings 里"启动失败"）。
2. `additionalProperties:false` 的对象会在**运行时**拒绝任何不在 `properties` 白名单里的键。`spec` 是异构的（raw_svg + 4 种 preset，各自带 layers/nodes/rows/steps/data 等嵌套），因此 `spec` 必须保持 **`additionalProperties: true`（开放）**——宿主只负责透传，真正的深校验在 execute 期的 `validateSpec()`/`drawFigure()`。把它改成 `false` 会让**每一次调用**都失败于 `"spec.kind" is not a declared property`。
3. output 用的是另一套 "value schema" DSL：**只能逐属性写 `required: true`**，写顶层 `required:[...]` 数组会编译报错。

回归防线：`scripts/_repro-activate.mjs` 在真实 cordis + ToolRuntime 下把五种 spec **逐一 execute 到产出 .svg**（不是只验证注册）。改完 index.js 后在安装目录跑它：`node _repro-activate.mjs`，见 `E2E: 5 pass` 才算数。

## 已知局限

1. 主题经 `prefers-color-scheme` 跟随**系统**主题；若你的应用内主题与系统相反，图与界面色调会拧（彻底解法需客户端插件配合，规划中）。
2. 桌面壳 `dsh-app:` 页面对认证文件路由支持存疑；本插件按 Web GUI（http）设计并已验证。
3. 文本宽度为近似测量（CJK 1em / 拉丁 0.55em），极端长词会截断加 `…` 并回报 warning。
4. 图静态、不可交互（设计决策）。
