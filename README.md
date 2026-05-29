# 多源无盘知识检索系统 (KBS Remote Use)

本系统是一个轻量化、纯内存态运行的 **Model Context Protocol (MCP)** 服务，作为 AI 编码 Agent 与远端多托管平台（GitLab 和 Azure DevOps）之间的“无盘化”智能中转管道。

它提供标准化的 Stdio 接口，允许 AI 编码 Agent 对远端多仓库下的 Wiki 和 Markdown 规范文档进行实时全文检索、按需读取和目录枚举，同时**确保本地研发机器上“零物理文件落地”**，规避企业安全合规风险。

---

## 🌟 核心特性

1.  **安全合规（无盘化原则）**：远端拉取的数据仅保存在 JS 运行环境内存中，在变量中转完毕后即刻自动垃圾回收，绝对不产生本地物理临时文件或缓存盘写入。
2.  **多源联合检索 (`kb_search`)**：支持并发查询配置的多个 GitLab/Azure DevOps 数据源，并自动基于相关性得分进行去重和重排序（Rerank），返回 Top-5 混合匹配结果。
3.  **防阻塞超时控制**：对每个连接器配属 `AbortController`，设定最大超时限制为 **8000ms**，超时或失败的源将被自动隔离，不阻塞其他正常源的查询。
4.  **全内存态 Fallback 降级检索**：当远端在线搜索 API 不可用时（如私有部署的 GitLab 限制或关闭了在线搜索 API 导致全局 Blobs 搜索报 500/403），静默拉取 ZIP 压缩包至内存 Buffer，在内存中解压过滤并通过 `Fuse.js` 快速构建临时模糊文本索引（10分钟 TTL 缓存机制）。
5.  **目录树结构感知 (`kb_list`)**：并发枚举多源下的 `.md` 文件列表，让 Agent 建立全局目录感知。
6.  **按需读取内容 (`kb_read`)**：解析带源标识的前缀 Slug 路由分发至对应连接器，实时读取在线 Raw 文本。

---

## 📦 环境要求

-   **Node.js**: 24.11+ (已验证 v26.0.0)
-   **包管理器**: PNPM

---

## 🚀 安装与编译

1.  安装依赖：
    ```bash
    pnpm install
    ```
2.  编译项目：
    ```bash
    pnpm build
    ```
    编译产物将生成在单入口的 `dist/index.js`。
3.  运行自测：
    ```bash
    pnpm test
    ```
    运行模拟 GitLab & Azure DevOps 的高保真测试套件，验证接口和降级功能的正确性。

---

## ⚙️ 配置文件说明

系统优先读取项目根目录下的私有配置文件 `config.private.json`（已加入 `.gitignore`）。如果不存在，将回退读取 `.env` 环境变量中的单源 GitLab 配置。

### 选项 A：多源联合配置 (`config.private.json`)

在根目录下创建 `config.private.json`，配置样例如下：

```json
{
  "timeoutMs": 8000,
  "sources": [
    {
      "type": "gitlab",
      "id": "gitlab_primary",
      "url": "https://gitlab.company.com",
      "projectId": "12345",
      "token": "glpat-XXXXXXX_yourGitLabToken",
      "branch": "main",
      "subDir": "docs",
      "fallbackMode": "auto"
    },
    {
      "type": "azure-devops",
      "id": "azure_secondary",
      "url": "https://dev.azure.com/myCompany",
      "projectName": "CorePlatform",
      "repoId": "98765-abcd-efgh",
      "token": "azpat-YYYYYYY_yourAzureToken",
      "branch": "master",
      "subDir": "standards",
      "fallbackMode": "force"
    }
  ]
}
```

*   `fallbackMode`: `'auto'` (默认，在线不可用时降级为内存 ZIP 搜索)、`'force'` (强制使用内存 ZIP 检索，适用于关闭了在线搜索 API 的内网服务)、`'none'` (不使用降级，出错直接报错)。

### 选项 B：单源极简配置 (`.env`)

在根目录下创建 `.env`，配置样例如下：

```bash
GITLAB_URL=https://gitlab.company.com
GITLAB_PROJECT_ID=12345
GITLAB_TOKEN=glpat-XXXXXXX_yourGitLabToken
GITLAB_BRANCH=main
WIKI_SUBDIR=docs
```

---

## 🤖 AI 编码 Agent 接入指南

本 MCP 服务采用标准的 **Stdio JSON-RPC 2.0** 通信，易于集成到各类现代 AI 辅助开发工具中。

### 1. Claude Code 接入

Claude Code 支持在全局或项目级别配置 MCP。你可以在终端中运行以下命令自动添加：

```bash
claude mcp add kbs-remote-use node /path/to/kbs-remote-use/dist/index.js
```

### 2. Cursor 接入

1. 打开 Cursor 选项：`Settings` -> `Features` -> `MCP`。
2. 点击 `+ Add New MCP Server`：
   - **Name**: `kbs-remote-use`
   - **Type**: `command`
   - **Command**: `node /path/to/kbs-remote-use/dist/index.js`
3. 保存后 Cursor 将自动加载并暴露 `kb_search`、`kb_read`、`kb_list` 三个工具。

### 3. VS Code 接入 (通过 Cline / Roo Cline 插件)

对于使用 VS Code 的开发者，可以通过安装支持 MCP 协议的 **Cline** 或 **Roo Cline** 插件进行集成：

1. 在 VS Code 中安装 **Cline** (或 **Roo Cline**) 插件。
2. 打开 Cline 插件面板，点击设置图标 (齿轮)，然后点击 "Edit MCP Settings" 按钮。
3. 系统将打开 `cline_mcp_settings.json` (或 `roo_cline_mcp_settings.json`) 配置文件。在 `mcpServers` 对象中添加以下配置：
   ```json
   {
     "mcpServers": {
       "kbs-remote-use": {
         "command": "node",
         "args": ["/path/to/kbs-remote-use/dist/index.js"],
         "disabled": false
       }
     }
   }
   ```
   *(请将 `/path/to/kbs-remote-use` 替换为克隆本仓库的本地绝对路径)*
4. 保存配置文件，Cline 插件将自动建立连接。您可以在 Cline 面板底部看到已成功注册的三个 `kb_` 工具。

### 4. GitHub Copilot (VS Code) 接入

VS Code 自 1.99 版本起已原生支持 MCP 服务器。在项目根目录下创建 `.vscode/mcp.json`：

```json
{
  "servers": {
    "kbs-remote-use": {
      "type": "stdio",
      "command": "node",
      "args": ["./dist/index.js"]
    }
  }
}
```

保存后，GitHub Copilot 将自动识别并加载 `kb_search`、`kb_read`、`kb_list` 三个工具。

> **安全说明**：本项目在 [.github/copilot-instructions.md](.github/copilot-instructions.md) 预置了防泄密引导指令，Copilot 在回答时会自动遵守"无盘化"原则，拦截任何将远端知识库批量落盘的操作。

---

## 🛠️ 注册的 Tool 接口规范

AI 编码 Agent 可以自动读取并调用以下三个工具：

| 工具名称 | 输入参数 | 返回值格式 | 说明 |
| :--- | :--- | :--- | :--- |
| `kb_search` | `{ query: string, limit?: number }` | `JSON Array` | 对配置的所有源进行并发联合检索，返回符合条件且去重排序后的混合 Top-N 结果，包含 `preview` 片段与唯一 `slug`。 |
| `kb_read` | `{ slug: string }` | `string` | 路由解析 Slug (如 `gitlab_primary:docs/api.md`) 并实时拉取该 markdown 文本内容，返回 Markdown 纯文本。 |
| `kb_list` | `{}` | `JSON Array` | 枚举各源下所有符合 subDir 及 `.md` 过滤条件的文件结构树与 Slug 映射。 |

---

## ⚠️ 安全与开发注意事项

-   本程序在生成的日志、说明及报错中**严禁包含特定开发机本地用户名及本地绝对路径**（例如 `/Users/username/...`），发布或分享配置时一律使用 `/path/to/` 等相对或通用占位符替代。
-   下载的 ZIP 包大小上限为 **50MB**，若远端压缩包超限，系统将抛出错误。若遇到此情况，请在 `subDir` 配置中指定更细粒度的子目录（例如 `docs/standards`）以收窄抓取范围。
