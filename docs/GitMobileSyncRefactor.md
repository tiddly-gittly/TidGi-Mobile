# Git 移动端同步重构方案

本文档记录 TidGi-Mobile 与 TidGi-Desktop 之间基于 Git 的同步机制重构设计。此次重构将横跨工作区内的多个项目：TidGi-Desktop、TidGi-Mobile、tw-mobile-sync、TiddlyWiki5。

相关 Issue：

- <https://github.com/tiddly-gittly/TidGi-Mobile/issues/88>
- <https://github.com/tiddly-gittly/TidGi-Mobile/issues/37>

## 核心目标

1. 移动端工作区从 SQLite 存储改为 Git 仓库文件夹存储
2. 桌面端通过 mobile-sync 插件提供 Git Smart HTTP 服务，移动端可直接 pull/push
3. 移动端与桌面端共用 tidgi.config.json 配置规范，各端只解析自己理解的字段
4. 保留 skinny HTML 启动机制，移动端从仓库文件系统读取 tiddlers 并注入 WebView

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        TidGi-Desktop                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              TiddlyWiki NodeJS --listen                 │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │           tw-mobile-sync 插件                    │    │    │
│  │  │  - GET /tw-mobile-sync/get-skinny-html (无鉴权) │    │    │
│  │  │  - Git Smart HTTP 路由 (Basic Auth)             │    │    │
│  │  │    - GET  /tw-mobile-sync/git/{workspaceId}/info/refs              │    │    │
│  │  │    - POST /tw-mobile-sync/git/{workspaceId}/git-upload-pack        │    │    │
│  │  │    - POST /tw-mobile-sync/git/{workspaceId}/git-receive-pack       │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                  │
│              通过 global.service 暴露 TidGi 服务给nodejs端插件               │
│              获取 git 路径、workspace token、repoPath          │
└─────────────────────────────────────────────────────────────────┘
                               │
                          局域网 HTTP
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        TidGi-Mobile                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  扫码导入: { baseUrl, workspaceId, token }              │    │
│  │  Git clone 到本地文件夹工作区                           │    │
│  │  同步: git pull / git push (Basic Auth)                │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  WebView 启动                                           │    │
│  │  - 从缓存读取 skinny HTML (按 TidGi 版本缓存)          │    │
│  │  - 从仓库文件系统解析 .tid/.meta 文件                  │    │
│  │  - 流式注入 tiddlers 到 WebView                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  路由与保存                                             │    │
│  │  - WebView 内调用 $tw.wiki.filterTiddlers() 做路由决策 │    │
│  │  - 原生层只负责 IO (Expo FS)                           │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## 各项目职责与改动范围

### TidGi-Desktop

改动文件/模块：

- src/services/wiki/wikiWorker/startNodeJSWiki.ts - 启动参数加 csrf-disable=yes
- src/services/git/interface.ts - 扩展服务接口，暴露 git 可执行路径与 repoPath 映射
- src/services/wiki/wikiWorker/services.ts - 把新接口注入 global.service

关键点：

- TiddlyWiki --listen 默认对 POST/PUT/DELETE 强制 CSRF header 校验，Git 客户端不带此头，会被 403 拒绝
- 必须在启动参数中加入 csrf-disable=yes 才能让 git push 通过
- workspace token 存在本地 config（不进 tidgi.config.json），插件通过 services API 查询

### tw-mobile-sync

改动文件/模块：

- 新增 Git Smart HTTP 路由模块（放在 src/tw-mobile-sync/server/Git/ 目录）
- types/tidgi-global.d.ts - 扩展声明，加入 git 路径与 token 查询接口

新增路由：

- GET /{workspaceId}/info/refs?service=git-upload-pack|git-receive-pack
- POST /{workspaceId}/git-upload-pack
- POST /{workspaceId}/git-receive-pack

实现要点：

1. 路由使用 body: "stream" 模式，直接把 request stream 转发给 git 子进程
2. 插件内自行解析 Authorization: Basic header，校验 token 是否匹配该 workspace
3. 校验失败返回 401 + WWW-Authenticate: Basic realm="TidGi"
4. 校验通过后 spawn git http-backend（或直接 spawn git-upload-pack/git-receive-pack）
5. 把子进程 stdout pipe 到 response

现有 skinny HTML endpoint 保持不变：

- GET /tw-mobile-sync/get-skinny-html - 无需鉴权，返回空壳 HTML

### TidGi-Mobile

改动文件/模块：

- src/store/workspace.ts - workspace 数据结构改为指向文件夹而非 SQLite
- src/services/WikiStorageService/ - 改为从文件系统读写 .tid/.meta 文件
- src/pages/WikiWebView/useTiddlyWiki.ts - 数据源从 SQLite 改为文件系统
- src/pages/Importer/ - 扫码导入改为 git clone 流程
- src/services/BackgroundSyncService/ - 同步改为 git pull/push
- 新增路由决策模块 - 移植桌面端 fs syncadaptor routingUtilities 逻辑，调用前端 $tw.wiki.filterTiddlers()

数据流变化：

- 之前：SQLite -> 流式注入 WebView
- 之后：文件系统(.tid/.meta) -> 解析 -> 流式注入 WebView

需要移植的 TiddlyWiki5 boot 子集函数（用于解析 .tid 文件）：

- loadTiddlersFromPath
- loadTiddlerFromFile
- parseFields
- parseJSONSafe
- defaultConfig

这些函数需改造为依赖注入的 FS 接口，由 Expo FS 实现。

### TiddlyWiki5

本次不需要修改 TiddlyWiki5 核心代码，只需从 boot/boot.js 中提取上述函数到移动端使用。

## 二维码与鉴权

二维码 JSON 格式：

```json
{
  "baseUrl": "http://192.168.1.100:5212",
  "workspaceId": "abc123",
  "token": "xxxxxx"
}
```

鉴权流程：

1. 移动端扫码获取 baseUrl、workspaceId、token
2. 把 token 作为该 remote 的私有字段存入本地（不进 tidgi.config.json）
3. Git 请求时组装 Authorization: Basic base64(":token") 或 base64("tidgi:token")
4. 插件侧解析 header，通过 global.service 查询该 workspace 的 token 并比对
5. 通过则继续处理 Git 请求，失败则返回 401

workspace token 存储位置：

- 桌面端：本地 config 的 workspace 部分（现有机制）
- 移动端：本地 workspace store（不 commit 到仓库）

## tidgi.config.json 配置规范

该文件存放在每个 wiki 工作区根目录，会被 Git 同步。

处理原则：

- 桌面端和移动端共用同一个文件
- 各端只解析自己理解的字段，未知字段原样保留不丢失
- 保存时只覆盖已知字段，不删除未知字段

移动端需支持的字段（第一期）：

- name - 工作区名称
- tagNames - 路由规则：按标签分配到子工作区
- includeTagTree - 是否包含标签树递归匹配
- customFilters - 自定义筛选器路由规则
- fileSystemPathFilters - 保存路径筛选器

配置更新时机：

- 配置变更不主动搬迁现有文件
- 只有当某个 tiddler 发生保存/变更时，才按新规则计算路径并落盘
- 这与桌面端行为一致

移动端不实现的桌面端功能：

- $:/config/FileSystemPaths 和 $:/config/FileSystemExtensions 作为 fallback（桌面端也很少用到）
- 文件系统监听 watch-fs（移动端无等价能力）

## 路由决策机制

路由决策在 WebView 内执行（因为需要 TiddlyWiki filter 引擎）：

1. WebView 提供 routeTiddler(title, fields) 接口
2. 内部调用 $tw.wiki.filterTiddlers() 依次匹配各 workspace 的 customFilters、tagNames 等规则
3. 返回目标 workspace/subwiki 标识与目标相对路径
4. 原生层收到结果后执行写盘/移动操作

路由规则优先级（与桌面端一致）：

1. 按 workspace order 顺序依次匹配
2. 首个命中的规则胜出
3. 未命中任何规则则保存到主工作区

需要实现和桌面端工作去设置里一样的设置界面，用于配置。

## Skinny HTML 启动机制

skinny HTML 是一个不含 tiddler store 的空壳 HTML，只包含 boot.css、boot.js 等启动必需文件。

获取与缓存：

- 通过 GET /tw-mobile-sync/get-skinny-html 从桌面端获取（无需鉴权）
- 按 TidGi 版本缓存在移动端（不放在仓库内，而是放在 cache 目录）
- 版本号作为缓存键，升级 TidGi 后自动更新

启动流程：

1. 移动端从缓存读取 skinny HTML（若无则请求桌面端）
2. 从仓库文件系统解析 .tid/.meta 文件
3. 把 tiddlers 流式注入 WebView
4. WebView 内的接收脚本完成 boot

现有模板位置：tw-mobile-sync/src/tw-mobile-sync/server/SaveTemplate/skinny-tiddlywiki5.html.tid

## Git 同步策略

移动端只做简单操作：

- fetch / pull - 拉取桌面端更新
- push - 推送本地修改

冲突处理策略：

- 移动端不做复杂合并
- 若 push 失败（冲突），推送到临时分支 client/{deviceId}/{timestamp}
- 通知桌面端/用户在桌面端处理合并
- 桌面完毕后通知移动端再次 pull 拉取合并结果，然后删除临时分支

移动端支持多个 remote：

- 现有机制已支持多 remote
- 扫码新增的 remote 按 (baseUrl, workspaceId) 去重
- 同一工作区可同时绑定多台电脑（家/公司）

## 实现步骤

### 阶段一：桌面端 Git Smart HTTP 服务

1. ✅ TidGi-Desktop: **不需要** 在 startNodeJSWiki.ts 加 csrf-disable=yes（移动端客户端加 X-Requested-With header）
2. ✅ TidGi-Desktop: 在 workspace service 添加 token API（getWorkspaceToken, validateWorkspaceToken）
3. ✅ TidGi-Desktop: 在 git service 添加 Git Smart HTTP 处理方法
   - ✅ getWorkspaceRepoPath(workspaceId)
   - ✅ getGitExecutablePath()
   - ✅ handleInfoRefs(workspaceId, service, req, res)
   - ✅ handleUploadPack(workspaceId, req, res)
   - ✅ handleReceivePack(workspaceId, req, res)
4. ✅ tw-mobile-sync: Git Smart HTTP 端点改为调用 Desktop service（不再 spawn）
   - ✅ git-info-refs-endpoint.ts（调用 Desktop 的 validateWorkspaceToken + handleInfoRefs）
   - ✅ git-upload-pack-endpoint.ts（调用 Desktop 的 handleUploadPack）
   - ✅ git-receive-pack-endpoint.ts（调用 Desktop 的 validateWorkspaceToken + handleReceivePack）
5. ✅ tw-mobile-sync: 清理 utils.ts 移除不再需要的函数（validateToken, getRepoPath, getGitPath）
6. ✅ tw-mobile-sync: 移除"服务缺失就放行"的 TODO 逻辑（确保安全）

### 阶段二：移动端文件系统工作区

1. ✅ TidGi-Mobile: 从 TiddlyWiki5 boot.js 提取文件解析函数，适配 Expo FS
   - ✅ src/services/WikiStorageService/tiddlerFileParser.ts
2. ✅ TidGi-Mobile: 改造 WikiStorageService 从文件系统读写 .tid/.meta
   - ✅ src/services/WikiStorageService/FileSystemWikiStorageService.ts
3. ✅ TidGi-Mobile: 改造 useTiddlyWiki.ts 数据源为文件系统
   - ✅ src/pages/WikiWebView/useStreamChunksToWebView/FileSystemTiddlersReadStream.ts
   - ✅ src/pages/WikiWebView/useTiddlyWiki.ts (添加useFileSystemStorage切换)
4. ✅ TidGi-Mobile: 实现 tidgi.config.json 解析与 UI 编辑（已知字段）
   - ✅ src/services/WikiStorageService/tidgiConfigManager.ts

### 阶段三：移动端 Git 同步

1. ✅ TidGi-Mobile: 改造扫码导入为 git clone 流程
   - ✅ src/services/GitService/index.ts (Git 操作封装)
   - ✅ src/services/GitService/useGitImport.ts (Git 导入 hook)
   - ✅ src/store/workspace.ts (扩展 IWikiServerSync 支持 token 存储)
2. ✅ TidGi-Mobile: 改造 BackgroundSyncService 为 git pull/push
   - ✅ src/services/GitService/GitBackgroundSyncService.ts
3. ✅ TidGi-Mobile: 实现 Basic Auth 鉴权注入
   - ✅ createAuthHeader in GitService/index.ts
4. ✅ TidGi-Mobile: 实现临时分支冲突处理策略
   - ✅ gitPushToConflictBranch in GitService/index.ts
   - ✅ handlePushConflict in GitBackgroundSyncService
5. ✅ TidGi-Mobile: 添加 X-Requested-With header 绕过 CSRF 校验
   - ✅ createAuthHeader 返回 {'X-Requested-With': 'TiddlyWiki-TidGi-Mobile'}

### 阶段四：路由与保存

1. ✅ TidGi-Mobile: 移植桌面端 routingUtilities 路由规则
   - ✅ assets/preload/tiddlerRouting.js (WebView 内路由逻辑)
   - ✅ src/services/WikiStorageService/TiddlerRoutingService.ts (原生层路由服务)
2. ✅ TidGi-Mobile: 在 WebView 内实现 routeTiddler 接口
   - ✅ tidgiMobileRouting API exposed to native
3. ✅ TidGi-Mobile: 原生层按路由结果执行文件写入/移动
   - ✅ FileSystemWikiStorageService 集成路由服务
   - ⚠️ 注意：完整的子 wiki 路由需要在添加子 wiki 支持后实现

## 实施状态总结

### 已完成 ✅

**tw-mobile-sync（插件端）- 完全重构为调用 Desktop service**

- ✅ Git Smart HTTP 端点改为"鉴权 + 调用 Desktop service"模式（不再 spawn git）
- ✅ Basic Auth 鉴权机制（调用 Desktop workspace.validateWorkspaceToken）
- ✅ git-info-refs-endpoint.ts - 调用 Desktop git.handleInfoRefs
- ✅ git-upload-pack-endpoint.ts - 调用 Desktop git.handleUploadPack
- ✅ git-receive-pack-endpoint.ts - 调用 Desktop git.handleReceivePack
- ✅ utils.ts 清理：移除 validateToken/getRepoPath/getGitPath（已由 Desktop 托管）
- ✅ 移除"服务缺失就放行"的 TODO 逻辑（确保安全）
- ✅ **已删除所有旧的 SQLite API 端点：**
  - ❌ server-sync-v1-endpoint.ts (旧同步 API v1)
  - ❌ server-get-skinny-json-endpoint.ts (旧 JSON 端点)
  - ❌ server-get-skinny-tiddlers-text-endpoint.ts (旧 tiddlers 文本)
  - ❌ server-get-tiddler-text-endpoint.ts (旧单个 tiddler)
  - ❌ server-get-non-skinny-tiddlywiki-tiddler-store-script-endpoint.ts (旧 store script)
  - ❌ client-info-endpoint.ts (旧客户端信息)
- ✅ **仅保留必需的端点：**
  - ✅ GET /tw-mobile-sync/get-skinny-html (无鉴权，HTML 模板)
  - ✅ GET /tw-mobile-sync/git/{workspaceId}/info/refs (Git Smart HTTP)
  - ✅ POST /tw-mobile-sync/git/{workspaceId}/git-upload-pack (Git fetch/pull)
  - ✅ POST /tw-mobile-sync/git/{workspaceId}/git-receive-pack (Git push)

**TidGi-Desktop（桌面端）- 完整实现 Git Smart HTTP 托管**

- ✅ Workspace service 扩展
  - ✅ src/services/workspaces/interface.ts - 添加 getWorkspaceToken/validateWorkspaceToken 方法签名
  - ✅ src/services/workspaces/index.ts - 实现 token 读取与校验（基于 workspace.authToken）
- ✅ Git service 扩展
  - ✅ src/services/git/interface.ts - 添加 repoPath、gitPath、handle* 方法签名
  - ✅ src/services/git/index.ts - 完整实现：
    - ✅ getWorkspaceRepoPath(workspaceId) - 返回 workspace.wikiFolderLocation
    - ✅ getGitExecutablePath() - 返回 dugite bundled git 路径（LOCAL_GIT_DIRECTORY + '/cmd/git'）
    - ✅ handleInfoRefs(workspaceId, service, req, res) - spawn git 处理 info/refs（流式）
    - ✅ handleUploadPack(workspaceId, req, res) - spawn git-upload-pack（流式 pipe）
    - ✅ handleReceivePack(workspaceId, req, res) - spawn git-receive-pack（流式 pipe）
- ✅ **CSRF 策略**：不需要 csrf-disable=yes，移动端客户端加 X-Requested-With header
- ✅ IPC 代理：所有新增方法已注册到 WorkspaceServiceIPCDescriptor 和 GitServiceIPCDescriptor

**TidGi-Mobile（移动端）- CSRF 绕过**

- ✅ **完全移除旧的 SQLite 实现**（已删除旧代码，无向后兼容）
- ✅ 文件系统 tiddler 解析器（.tid/.meta）
- ✅ FileSystemTiddlersReadStream（替代 SQLite stream）
- ✅ FileSystemWikiStorageService（完全替代旧的 WikiStorageService）
  - ✅ Git-based change observer（基于 git status 的变更监听）
  - ✅ 文件保存与删除
  - ✅ 路由集成（完整实现）
- ✅ tidgi.config.json 管理器（已知字段解析+未知字段保留）
  - ✅ readTidgiConfig / getTidgiConfig
  - ✅ writeTidgiConfig / saveTidgiConfig
  - ✅ 字段保留机制
- ✅ Git 操作封装（clone, pull, push, conflict handling）
  - ⚠️ 需要安装 `isomorphic-git` 依赖
- ✅ GitBackgroundSyncService（完全替代旧的 BackgroundSyncService）
  - ✅ sync() 主同步方法
  - ✅ getOnlineServerForWiki()
  - ✅ syncWikiWithServer()
  - ✅ getChangeLogsSinceLastSync()（完整实现：解析 git log）
- ✅ useGitImport hook（替代旧的 useImportHTML）
- ✅ Workspace store 扩展（token 存储）
- ✅ 路由服务完整实现（TiddlerRoutingService）
  - ✅ tagNames 直接匹配
  - ✅ includeTagTree 支持（简化版）
  - ✅ fileSystemPathFilters 解析
  - ⚠️ customFilters 完整评估需要 WebView（基础框架已就绪）
- ✅ WebView 路由脚本（tiddlerRouting.js）
- ✅ UI 界面适配
  - ✅ Importer/Index.tsx - Git QR 码导入
  - ✅ GitSyncStatus.tsx - 同步状态和冲突提示
  - ✅ WorkspaceSettings.tsx - tidgi.config.json 编辑
  - ✅ WikiModelContent.tsx - 集成新组件
- ✅ 插件类型修复（file-system-syncadaptor.ts）
- ✅ **CSRF header 添加**
  - ✅ src/services/GitService/index.ts - createAuthHeader 返回 {'X-Requested-With': 'TiddlyWiki-TidGi-Mobile'}
  - ✅ 所有 Git 操作（clone/pull/push）自动带上此 header

**已删除的旧文件：**

- ❌ src/services/SQLiteService/ (整个目录已删除)
- ❌ src/services/ImportService/ (旧的 SQLite 导入服务，已删除)
- ❌ src/pages/Importer/ImportBinary.tsx (已删除)
- ❌ src/pages/Importer/useImportBinary.ts (已删除)
- ❌ src/pages/Importer/useImportHTML.ts (已删除)
- ❌ src/pages/WikiWebView/useStreamChunksToWebView/SQLiteTiddlersReadStream.ts (已删除)
- ❌ src/services/BackgroundSyncService/index.ts (旧 SQLite 同步，已完全替换)
- ❌ src/services/WikiStorageService/index.ts (旧 SQLite 存储，已完全替换)
- ❌ src/services/WikiStorageService/ignoredTiddler.ts (已删除)

**清理完成：**
- ✅ 所有 SQLite 相关代码已删除
- ✅ 所有旧的导入逻辑已删除
- ✅ 无向后兼容代码残留
- ✅ 仅保留注释中的 SQLite 说明（用于文档）

**新的服务结构：**

- ✅ src/services/BackgroundSyncService/index.ts → GitBackgroundSyncService
- ✅ src/services/WikiStorageService/FileSystemWikiStorageService.ts
- ✅ src/services/GitService/ (Git 操作模块)
- ✅ src/pages/WikiWebView/useStreamChunksToWebView/FileSystemTiddlersReadStream.ts

### 待完成 ⏸️📋测试与集成）**

- 📋 验证 dugite 打包后 git-upload-pack/git-receive-pack 可用性
- 📋 验证 Git Smart HTTP 流式传输性能
- 📋 E2E 测试：移动端 push/pull 完整流程

**TidGi-Mobile**

- global.service.workspace.validateWorkspaceToken()
- global.service.workspace.getWorkspaceToken()

## 关键文件索引

### TidGi-Desktop

- src/services/wiki/wikiWorker/startNodeJSWiki.ts - wiki 服务启动
- src/services/git/interface.ts - git 服务接口定义
- src/services/git/gitOperations.ts - git 操作实现（dugite）
- src/services/wiki/wikiWorker/services.ts - 注入到插件的服务
- src/services/workspaces/tidgi.config.schema.json - 配置 schema
- src/services/workspaces/syncableConfig.ts - 可同步字段列表与默认值
- src/services/database/tidgiConfig.ts - 配置读写实现

### tw-mobile-sync

- src/tw-mobile-sync/server/TidGi-Mobile/server-get-skinny-html-endpoint.ts - skinny HTML endpoint
- src/tw-mobile-sync/server/SaveTemplate/skinny-tiddlywiki5.html.tid - HTML 模板
- src/tw-mobile-sync/types/tidgi-global.d.ts - TidGi 服务类型声明

### TidGi-Mobile

- src/store/workspace.ts - workspace 状态管理
- src/services/WikiStorageService/index.ts - wiki 存储服务
- src/pages/WikiWebView/useTiddlyWiki.ts - WebView 启动与数据注入
- src/pages/Importer/useImportHTML.ts - 导入流程
- src/services/BackgroundSyncService/index.ts - 后台同步服务
- src/constants/paths.ts - 路径常量

### TiddlyWiki5

- boot/boot.js - 需提取的文件解析函数所在位置

### 桌面端 FileSystem SyncAdaptor（移植参考）

- TidGi-Desktop/src/services/wiki/plugin/watchFileSystemAdaptor/FileSystemAdaptor.ts - 保存/删除逻辑
- TidGi-Desktop/src/services/wiki/plugin/watchFileSystemAdaptor/routingUtilities.ts - 路由规则实现
- TidGi-Desktop/src/services/wiki/plugin/watchFileSystemAdaptor/externalAttachmentUtilities.ts - 附件处理

## 风险与注意事项

1. CSRF 禁用：csrf-disable=yes 会降低安全性，但在局域网私有场景下可接受；若有公网暴露需求需额外考虑
2. Git 二进制依赖：dugite 在打包时会被裁剪，需确认保留了 git-upload-pack/git-receive-pack 相关命令
3. 大文件/二进制 tiddler：canonical_uri 机制需保留，避免仓库过大
4. 移动端 JS Git 实现：若选用 isomorphic-git 等库，需确认其 Expo FS 兼容性与性能
