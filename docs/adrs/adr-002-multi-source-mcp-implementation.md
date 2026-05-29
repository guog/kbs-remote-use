# ADR-002: 多源无盘知识检索系统实现决议 (ADR)

| 属性 | 内容 |
| :--- | :--- |
| **决议编号** | ADR-002 |
| **关联 PRD** | [PRD-001](../prds/prd-001-multi-source-stateless-mcp.md) |
| **当前状态** | 已采纳 (Accepted) |
| **作者** | Antigravity |
| **Date** | 2026-05-29 |

---

## 1. 背景与上下文 (Context)
按照 [PRD-001](../prds/prd-001-multi-source-stateless-mcp.md) 的规划，我们需要实现一个同时支持 GitLab 和 Azure DevOps 联合搜索的 Model Context Protocol (MCP) 本地服务。
该系统必须绝对避免在磁盘上保存任何远端敏感 Wiki / Markdown 文件以符合企业信息安全审计要求。此外，必须处理在线搜索 API 的各种异常或不可用状况（降级到全内存 ZIP 解压缩与模糊检索），并实现 8 秒超时并发隔离。

---

## 2. 决策理由与权衡 (Decision & Trade-offs)

### 2.1 内存降级策略选择 (ZIP 归档 vs 逐个 API 爬取)
*   **路线 A (在线 ZIP 打包 + 内存解压 Fuse.js 检索)** (采纳)：
    *   *优势*：仅需发起一次 HTTP 请求即可下载整个仓库/目录的代码包。配合 `adm-zip` 在内存 Buffer 中解开并过滤出 Markdown，用 `Fuse.js` 建立缓存索引。网络往返（RTT）极少，10 分钟 TTL 内后续检索极其迅速（<200ms）。
    *   *劣势*：首次拉取 zip 归档需要消耗较大的单次带宽与数秒时间。
*   **路线 B (逐个 API 递归爬取树结构与文件内容)**：
    *   *优势*：不需要下载整个 zip 包。
    *   *劣势*：需要递归发送成百上千次 API 请求以获取每个文件的树结构与内容，耗时过长，且会触发远端 API 限流（Rate Limit）。

### 2.2 多源并发与隔离机制 (Promise.all vs Promise.allSettled)
*   **路线 A (Promise.allSettled + AbortController)** (采纳)：
    *   *优势*：当其中一个源服务（例如 Azure DevOps）发生连接超时（8000ms），`Promise.allSettled` 可以保证其他正常的源（例如 GitLab）结果依然被收集和展示，实现高可用隔离。
*   **路线 B (Promise.all)**：
    *   *劣势*：任何一个源失败都会导致整个 `kb_search` 抛出异常，健壮性极差。

---

## 3. 最终决议与后效 (Consequences)

### 采纳结论：
我们采纳 **路线 A (在线 ZIP 打包 + 内存解包 Fuse.js 检索)** 进行内存降级，并采用 **Promise.allSettled + AbortController** 实现多源检索并发超时隔离。

### 决策执行后的影响：
*   **正面影响**：
    *   完全符合安全审计的“零落盘”原则。
    *   保障在企业网络隔离、API 500/403 等异常环境下的极端健壮性。
    *   极快（<200ms）的后续内存检索延迟。
*   **技术代价**：
    *   内存中会短暂驻留 zip 包解压后的数据，需要配合 GC 和 TTL 机制（10分钟）自动销毁，以防内存溢出（限制 ZIP 大小为 50MB）。
