# 维护者笔记（dsh-inline-figures）

README 面向使用者，本文件保存踩坑记录与实现约束。改动前先读这里，尤其是"勿回退"两节。

## 官方插件契约（2026-10-04 核实，勿回退）

证据：`@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`（SKILL.md + references/host-plugin.md）、`@deepseek-ai/dsh-plugin-manager/README.md`、`@deepseek-ai/dsh-app-boot/lib/index.js` 的 `evaluatePluginCompatibility`、以及随包发布的 `dsh-tool-cordis` / `dsh-experimental-agent-team` 的 package.json。以上每一条都由 `test/compliance.test.js` 机器断言，改坏了测试就红。

1. **依赖**：宿主插件只写 `peerDependencies`。随 dsh 发布的包由宿主从 dsh 安装解析，bundle 不该依赖它们（host-plugin.md 原话：*A Host-only bundle needs no dependencies*）。写进 `dependencies` 会让 pnpm 在 profile 里装一份运行时副本——服务身份被复制，且宿主一升级版本就对不上。只有纯库（`schemastery`、`sharp`）才放 `dependencies`。
2. **兼容门禁**：`evaluatePluginCompatibility` 只检查 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 peer 是否满足运行版本（`dsh-app-boot` 的版本），不满足时在 pnpm 之前拒绝安装并报 `incompatible-version`。**至少要声明一个 dsh-* peer，否则这道门禁是空的**——别人会在不兼容的宿主上装成功，然后运行期崩。豁免走 `dsh plugin allow-version <pkg@version> --dsh-version <runtime> --accept-risk`。
3. **资源注册**：`apply()` 内每个资源都要走 `ctx.effect()` 或 `ctx.on()` 并返回清理函数。`ctx.systemPrompt.section()` 的返回值就是 Cordis effect disposer，`ctx.tools.register()` 同理。否则行被禁用后，工具与提示段仍留在会话里。
4. **导出形式**：`export function apply(ctx, config)` + 可选 `export const inject` / `Config`，或默认导出一个服务类；两种形式不要混用。
5. **展示元数据**：`meta.title`/`meta.description`、`locale/<lang>.json`（同名字段）、顶层 `icon`（相对路径，SVG/PNG/JPEG/WebP，≤256 KiB）；`exports` 要含 `./package.json` 与 `./locale/*.json`，`files` 要含这些文件。插件卡片与设置页在**不激活**插件的情况下读这些字段。
6. **安装入口**：`dsh plugin add <package>`（registry / 绝对路径 / git / tarball 都认）、Web 侧边栏 Plugins 页、`plugin_manager` 工具。**不要**手写 profile 的 `package.json`、`cordis.patch.yml`，不要往 `$DSH_HOME` 下建包，不要在 profile 目录跑 pnpm——`install_bundle` 会做这些。
7. **重启语义**：替换已安装包的 JS 需要重启进程才加载新的一代模块；行启停可经 HMR 即时生效。

### 这些规则推翻了早期的做法

早期把 19 个 `@deepseek-ai/*` 写进 `dependencies`，pnpm 于是在 profile 顶层装了一份 27.7 MB 运行时副本；被 pnpm 剪掉后改成"把闭包塞进安装目录 + 手写 manifest"，由此产生了 `install-to-profile.ps1`、`build-offline-closure.mjs`、`nest-profile-deps.ps1`、`extract-app-tree.mjs`、`stage-sharp.mjs` 一整套离线安装器。

正式路径现在是 peer + 官方安装器，上述脚本降级为**离线兜底**（registry 不可达的机器），不进 README 的正规流程。

`sharp` 同理：不再需要从 app 解包。它是正常 `dependencies`，官方安装会装预编译二进制（0.35.x 无 install script，不受 pnpm 构建脚本审批影响）。运行期三级解析：插件内嵌套副本 → bare import（hoisted 布局命中 profile 根）→ 离线 staging 缓存。

## 2026-10 复核结论（待修）

以下四项目前仍未修，对应 README 的 Known issues：

1. **暗色模式在 PNG 路径失效**。`lib/primitives.js` 的 `@media (prefers-color-scheme:dark)` 只在浏览器渲染 SVG 时生效；改成嵌 PNG 后渲染者是 sharp/librvg，没有主题偏好。实测交付 PNG 像素：浅色 `#f4f4f2` 148,205 px，深色 `#2f2f2d` 36 px。盒内文字仍可读，标题/轴标签/时间线标签落在透明画布上，暗色界面下不可读。
   修法：栅格前注入一层整幅不透明底（只影响 PNG，SVG 存档保持透明）。
2. **同名并发写失败**。`lib/host-utils.js` 的写盘重试只有 2 次，slug 默认等于 `spec.kind`，模型一步内发多个 `draw_figure` 时实测 5 并发丢 3。修法：重试次数提到 8，或文件名带 `callId`。
3. **引导语脂肪**。`GUIDANCE_TEXT` 6,133 字符（约 1,700 token）+ 工具描述 902 + `SPEC_DESCRIPTION` 909 ≈ 2,200 token 常驻系统提示，且"SVG 优先/永不用 ASCII/原子回答豁免"三处在引导语与工具描述里重复。ASD-STE100 散文风格规则与出图无关，可移出。
4. **index.js 的测试是源码字符串匹配**。`test/index.test.js` 对 index.js 做正则断言，语义等价的重构会挂、真 bug 能过。修法：抽出 `executeDraw(args, deps)` 接缝，把 `scripts/_repro-*.mjs` 的断言搬进 `node --test`。

配套复现脚本在仓库外的 `_probe/figs-review/`（像素统计、并发压测、布局扫描、依赖与提示词计量），未纳入版本控制。

## 特性（原 README）

- **判断式出图（非仪式）**：模型顺着回答写，在"这里用图比用话更快更清楚"的那个点才插图——不先出图、不摊配额。多数回答 0–2 张。判据是比较性的，不是"命中结构就画"。
- **SVG 优先**：主路径是模型手写 `raw_svg`；`architecture`/`compare`/`timeline`/`chart` 四型 JSON 规格为兜底。**永不用 ASCII/Unicode 字符画**。
- **满宽渲染**：viewBox 680 排版、固有宽 1600，浏览器等比缩放到内容列宽。
- **开关**：Settings 插件表单 `enabled`（volatile，改完新会话生效）；关闭后工具与系统提示引导同时消失。
- **卫生**：会话目录内 `.gitignore`（内容 `*`）、每会话 200 文件 LRU 清理（PNG 随 SVG 成对清理）、标签截断以 warnings 回报模型。

## 开发

```powershell
cd packages/dsh-inline-figures
node --test --test-isolation=none      # 沙箱下 node --test 会 spawn EPERM
$env:UPDATE_GOLDEN='1'; node --test test/architecture.test.js   # 重新生成布局快照（目检后提交）
```

## 安装（本机实测过的坑）

**全程离线**：脚本从 app 解包树计算依赖闭包（`build-offline-closure.mjs`，32 包），实体化进安装目录与持久 staging（`~/.dsh/vendor`），然后手写回 profile manifest 并用宿主同款解析做加载探针。完成后**重启 DSH 应用**。

为什么这么绕（全部本机实测踩过）：

1. 宿主 Node 对外部 bundle 的 `@deepseek-ai/*` import 走原生解析，asar 内的包在其解析链上不可见 → 闭包必须随 bundle 实体安装。
2. pnpm 会把 profile 顶层"未声明"的 node_modules 条目当冗余剪掉 → 闭包必须放在**安装目录内部**。
3. `dsh plugin add`（pnpm）走 registry，网络不稳时中途失败会**回滚 manifest**、把 bundle 整个注销 → 改手动放置 + manifest 注册。
4. `file:` 指工作区时 pnpm 移除依赖会顺 junction 毁源目录（发生过，git 救回）→ staging 用持久副本 `~/.dsh/vendor`。
5. DSH 运行时升级后：重新解包 app 树、重跑脚本即可（闭包自动跟版本）。

`resources/app.asar.unpacked/dsh/node_modules` 只有 4 个带原生资源的包，完整 289 包在 `app.asar` 里，所以必须先解包（`scripts/extract-app-tree.mjs`）。

## 宿主工具 schema 契约（勿回退）

`defineTool` 的 schema 编译器（dsh-tools）有两条硬规则，违反时插件**"启动失败"或每次调用报 `invalid arguments`**：

1. **每个 `type:'object'` 节点**（顶层与所有嵌套）必须显式写 `additionalProperties: true|false`，否则 `defineTool` 在注册时抛错。
2. `additionalProperties:false` 的对象会在**运行时**拒绝任何不在 `properties` 白名单里的键。`spec` 是异构的，因此必须保持 **`additionalProperties: true`（开放）**——宿主只负责透传，真正的深校验在 execute 期的 `validateSpec()`/`drawFigure()`。改成 `false` 会让每一次调用都失败于 `"spec.kind" is not a declared property`。
3. output 用的是另一套 "value schema" DSL：**只能逐属性写 `required: true`**，写顶层 `required:[...]` 数组会编译报错。

回归防线：`scripts/_repro-png-check.mjs` 用**真实 cordis** 挂载 SystemPrompt + ToolRuntime + 本插件，逐一把五种 spec execute，断言 markdown 嵌 PNG + 磁盘 PNG magic + SVG 孪生文件存在，最后卸载插件并断言 `draw_figure` 确实消失（后者只有走 `ctx.effect` 注册才会通过）。从包根目录跑，期望 `E2E: 6 pass, 0 fail`。另一个 `scripts/_repro-nudge.mjs` 期望 `E2E: 3 pass, 0 fail`。

加载器为何写显式 `.cjs` 文件 URL 而不是 bare `import('sharp')`：实测 bare 解析**随安装布局变化**——在插件安装目录内它落到本插件的 `dist/index.mjs`，但从工作区包目录跑则落到用户家目录 `~\node_modules\sharp\lib\index.js`（另一个更老的副本）。显式文件 URL 两个位置都确定命中同一个 staged 副本。

## 图片预览失败的历史根因（勿回退）

GUI markdown 的 `![]()` 经 `<img src>` 由 `api/file?path=…` 喂给浏览器；服务端对所有文件带 `Content-Security-Policy: sandbox` + `nosniff`（防同源开放 HTML/SVG XSS）。Chromium 对带 CSP sandbox 的 SVG 拒绝光栅化 → `<img>` onError → UI 显示"图片无法预览 · alt"。这不是 MIME 问题，也**不是插件能改服务端头的事**——唯一干净解即 PNG 光栅内嵌（PNG 无文档语义，sandbox 头无害）。

## 已知局限

1. 主题经 `prefers-color-scheme` 跟随**系统**主题；PNG 路径下该机制失效（见上）。
2. 桌面壳 `dsh-app:` 页面对认证文件路由支持存疑；本插件按 Web GUI（http）设计并已验证。
3. 文本宽度为近似测量（CJK 1em / 拉丁 0.55em），极端长词会截断加 `…` 并回报 warning。
4. 图静态、不可交互（设计决策）。
5. `figureDirName` 认不出的会话 id 全部落到 `fallback` 目录，共享同一个 200 文件 LRU 预算。修法：对原始 id 取 8 位哈希。
6. `sanitize.js` 有四类绕过：未加引号 `href`、`style` 里的 `url()`、实体化 `javascript:`、嵌套自闭合 `<svg/>`；且从不注入 `xmlns`。载体是 `<img>`，安全风险低，但"会剥掉外链"的声明与实际不符。
