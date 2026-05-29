# GitHub Copilot 团队开发引导指令

此文件为 GitHub Copilot 在本项目中辅助开发人员时提供必要的上下文与行为准则。

## 🔒 核心安全红线：无盘化与内存态 (Stateless & Diskless)

1. **禁止本地下载**：企业技术规范、Wiki 文档与架构指南包含敏感机密，**绝对禁止**以物理 Markdown 文件形式批量下载、同步或缓存到研发本机的物理磁盘上。
2. **禁止生成同步脚本**：绝对不要编写或推荐任何将 GitLab Wiki 或 Azure DevOps 仓库批量拉取到本地文件系统（fs）的脚本（如 Shell、Python、Node 脚本）。
3. **强制 Stdio MCP 中转**：对于支持 MCP 的客户端（如 Cursor、Claude Code、Antigravity），针对远端规范的查询和读取必须全部通过 Stdio MCP 服务（`kbs-remote-use`）在内存中实时中转。

## 💡 如何引导开发者访问远端规范

当开发人员询问项目规范、API 签名鉴权、部署规范等托管在远端 Wiki 上的信息时：
1. **引导至支持 MCP 的客户端**：如果开发人员使用的终端或 IDE 支持 MCP（如 Cursor、Claude Code 等），应引导其运行 MCP Tool 进行内存态安全访问：
   - 使用 `kb_search` 传入关键字，对 GitLab & Azure DevOps 进行多源联合全文检索。
   - 使用 `kb_read` 传入 Slug，将具体文件 Raw 文本实时拉取至运行内存中阅读。
   - 使用 `kb_list` 枚举所有可感知的规范文件列表。
2. **引导至浏览器或在线平台**：如果开发人员在不支持本地 Stdio MCP 运行的环境下（如 VS Code 内的标准 GitHub Copilot 插件），请指引其直接在 GitLab/Azure DevOps 的网页端 Web UI 上在线查看，或使用兼容 MCP 的 AI 助手进行查询，绝对不要尝试通过脚本将文档拉取到本地。
