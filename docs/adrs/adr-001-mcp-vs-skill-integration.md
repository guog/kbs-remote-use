# ADR-001: 编码 Agent 客户端检索技术选型 (MCP vs Skill)

| 属性 | 内容 |
| :--- | :--- |
| **决议编号** | ADR-001 |
| **当前状态** | 已采纳 (Accepted) |
| **作者** | Antigravity |
| **日期** | 2026-05-28 |

---

## 1. 背景与技术限制 (Context)
为了让研发团队使用的本地 AI 编码 Agent 能够安全访问 GitLab 中的技术 Wiki 知识库，团队针对集成机制进行选型。本地 Agent 链存在以下优先级：
1.  **GitHub Copilot (VS Code & CLI) [最重要]**
2.  **Cursor [次要]**
3.  **Antigravity (IDE & CLI) [第三]**
4.  **Claude Code (CLI) [第四]**
5.  **Codex [最低]**

其中，Cursor、Antigravity 和 Claude Code 原生支持 **MCP (Model Context Protocol)** 协议；而最核心的 GitHub Copilot 不支持本地 Stdio MCP 接入，且由于防泄密红线，**绝对禁止在本地磁盘落盘存储 Wiki 物理文件**。

---

## 2. 技术路线评估

### 路线 A：通过 Stdio 协议搭建 MCP 服务 (采纳)
*   **适用对象**：Cursor、Antigravity、Claude Code
*   **优势**：Agent 通过 Tool Call 自动按需请求，数据在内存中即查即用，本地磁盘零物理文件残留，安全性极高。
*   **对 Copilot 的局限**：Copilot 无法直接运行 Stdio MCP 命令行。

### 路线 B：客户端静态技能声明与引导 (采纳)
*   **适用对象**：GitHub Copilot、Codex
*   **优势**：在 Copilot 环境下放置配置文件 [.github/copilot-instructions.md](../../.github/copilot-instructions.md) 声明检索规则，当 Copilot 无法本地扫描时，拦截并提示开发人员，保障资产不落地。
*   **未来扩展**：在企业版环境下，通过 `mcp-to-http` 将 MCP 转化为 HTTP 接口并注册为 Custom Copilot Participant，实现 Copilot 侧的在线检索。

---

## 3. 最终决策

采纳 **“内存态 MCP Server + 项目级 Copilot 引导指令”** 的混编接入方案。
*   **对于 Copilot (第一优先级)**：采用无盘化离线引导。禁止任何批量下载脚本在研发本地运行，利用 Copilot Custom Instructions 规避合规风险。
*   **对于 Cursor/Antigravity/Claude Code**：使用 Stdio 运行打包好的 [dist/index.js](../../dist/index.js)。
