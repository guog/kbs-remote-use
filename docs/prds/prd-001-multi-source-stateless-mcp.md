# PRD-001: 多源无盘知识检索系统 产品需求文档 (PRD)

| 属性 | 内容 |
| :--- | :--- |
| **文档编号** | PRD-001 |
| **版本** | V2.0 (单源/多源整合版) |
| **状态** | Proposed (已提议) |
| **作者** | Antigravity |
| **日期** | 2026-05-29 |

---

## 1. 项目背景与产品定位

### 1.1 背景
在日常软件开发过程中，团队的核心技术规范、架构准则、API 约定和业务指南通常托管在远端的代码仓库（如 GitLab、Azure DevOps）中。为了让本地 AI 编码 Agent（如 Cursor、Antigravity、Claude Code 等）在日常编程中能够自动获取并严格遵守这些规范，必须为 Agent 提供一个便捷、标准的远端知识检索与读取通道。

随着组织规模的扩大，开发团队的文档与规范通常散落在异构的托管平台中。因此，系统不仅需要支持单一 GitLab 仓库的读取，还要具备跨越不同平台（GitLab 与 Azure DevOps）进行多源多仓库联合检索的能力。

### 1.2 核心痛点
*   **安全合规红线**：企业 Wiki 知识库和规范中包含高度敏感的商业机密和核心技术细节。根据公司信息安全规定，**绝对禁止在研发本地磁盘上批量下载、同步或缓存任何 Wiki 物理 Markdown 文件**。
*   **多源知识割裂**：规范文档散落在 GitLab 与 Azure DevOps 等不同的托管平台上。缺乏统一的入口，导致 AI 编码 Agent 无法同时进行联合检索，进而生成的代码可能违反某些未被检索到的技术规范。
*   **企业内网高级搜索易失效**：许多企业私有部署的 GitLab 或 Azure DevOps 服务器由于资源限制，未启用或限制了全局搜索服务，直接调用平台提供的 Blobs 搜索 API 时会触发 HTTP 500 或 403 错误，导致在线检索功能不可用。
*   **缺乏统一标准接口**：不同的 AI 编码 Agent 支持不同的协议，缺乏一个统一、安全、且能保证低延迟和容灾性的本地中转服务。

### 1.3 产品定位
本系统定位为一个**轻量化、纯内存态运行的 Stdio MCP (Model Context Protocol) 服务**。它作为 AI 编码 Agent 与远端多托管平台（GitLab/Azure DevOps）之间的“无盘化”智能中转管道，提供统一的 Stdio 接口，支持对远端多源 Wiki 知识库的实时在线全文检索、按需实时读取和目录枚举，并支持在在线搜索 API 失效时的**“全内存态解包降级检索”**，同时确保在研发机器本地“零物理文件落地”。

---

## 2. 目标用户与使用场景

### 2.1 目标用户
*   **多平台开发人员**：在日常编码中使用支持 MCP 协议的 AI 编码 Agent，并同时依赖托管在 GitLab 与 Azure DevOps 上的规范文档。
*   **安全合规管理员**：负责监管和审计开发环境中的信息安全，确保敏感代码及文档不会在本地持久化留痕。

### 2.2 典型使用场景

#### 场景 A：跨数据源联合模糊检索
*   **描述**：开发人员提问：“当前项目的 API 接口签名鉴权与多云环境部署规范是什么？”
*   **流程**：
    1.  Agent 自动触发 `kb_search`，传入关键词 `签名鉴权 部署规范`。
    2.  MCP 服务并发请求配置好的 **GitLab 仓库** 和 **Azure DevOps 仓库**。
    3.  收集并规范化两边返回的检索结果，经 Reranker 排序合并后返回 Top-5 最佳混合匹配结果（如既包含 GitLab 的鉴权规范，又包含 Azure DevOps 的部署指南）。

#### 场景 B：按需实时无盘读取
*   **描述**：Agent 检索到了 `gitlab:12345/docs/redis-guide.md`，需要阅读其内容以生成符合规范的 Redis 缓存工具类。
*   **流程**：
    1.  Agent 调用 `kb_read` 工具，传入 slug `gitlab:12345/docs/redis-guide.md`。
    2.  MCP 服务根据前缀路由分发至 GitLab 连接器，实时通过 API 获取文件 Raw 内容。
    3.  数据全部留在运行内存中，直接返回给 Agent，本地不发生任何物理磁盘写入。

#### 场景 C：目录树结构感知
*   **描述**：Agent 启动或用户提问关于“项目里都有哪些开发规范”时。
*   **流程**：
    1.  Agent 调用 `kb_list`，MCP 服务并发枚举所有仓库下可读取的 Markdown 文件列表。
    2.  合并并返回带有源标识的路径列表，使 Agent 快速构建对整个知识图谱的全局感知。

#### 场景 D：在线检索 API 失效时的全内存态 Fallback 降级
*   **描述**：企业私有部署的 GitLab 没有开启或禁用了在线全文搜索 API，导致在线全文搜索 API 报 HTTP 500 错误。
*   **流程**：
    1.  MCP 服务在线检索 API 失败，静默激活内存态 Fallback 降级。
    2.  服务向远端请求下载分支的 `archive.zip` 包直接存入内存 Buffer。
    3.  利用内存解压组件解析文件，并在内存中使用 `Fuse.js` 快速构建模糊文本索引。
    4.  从内存索引中计算并返回搜索结果，整个过程无任何本地物理磁盘写入。

#### 场景 E：异常隔离与超时容灾
*   **描述**：企业部署的 Azure DevOps 服务因网络抖动超时，但 GitLab 依然可用。
*   **流程**：
    1.  Agent 发起检索，MCP 系统通过 `Promise.allSettled` 并行向两个源发出请求，且每个源设定最大 8000ms 超时限制。
    2.  Azure DevOps 连接器超时，MCP 容器捕获并隔离该错误；GitLab 连接器正常返回，系统对其排序并呈递结果给 Agent，确保部分数据源失效时不阻塞用户的编码辅助。

---

## 3. 系统架构与数据流

本系统在本地研发机器上作为 MCP Server 运行，采用 Stdio 进行 JSON-RPC 传输，并通过 HTTPS 实时对接 GitLab/Azure DevOps 的 REST API。

```mermaid
sequenceDiagram
    participant Agent as AI 编码 Agent (如 Cursor)
    participant Core as MCP 联合调度器 (Core Server)
    participant GL as GitLab 连接器 (GitLabConnector)
    participant AZ as Azure DevOps 连接器 (AzureConnector)
    participant Remote as 远端服务器 (GitLab / Azure DevOps)

    Note over Agent, Core: 局域网 Stdio (JSON-RPC)
    Note over GL, Remote: 外网/内网 HTTPS REST API

    %% 场景 1: 联合查询与降级
    Agent->>Core: CallTool: kb_search (query="JWT鉴权")
    
    par 并发请求 A (设置 8s 超时)
        Core->>GL: 检索 (query="JWT鉴权")
        GL->>GL: 尝试在线 Blobs 搜索 API
        alt 在线搜索成功
            GL-->>Core: 返回 [{ slug, score, preview }]
        else 触发 500 / 403 错误 (降级激活)
            GL->>Remote: HTTPS GET 拉取 archive.zip 至内存
            GL->>GL: 内存解包并使用 Fuse.js 搜索
            GL-->>Core: 返回内存模糊检索结果集
        end
    and 并发请求 B (设置 8s 超时)
        Core->>AZ: 检索 (query="JWT鉴权")
        AZ->>AZ: 尝试在线 Code Search API
        alt 超时或连接失败 (8s 断路)
            AZ-->>Core: 返回 Error (隔离不影响 GL)
        end
    end

    Note over Core: Rerank: 对 GL 和 AZ 的所有成功结果进行合并<br/>并依相关性 Score 统一降序排列，取 Top-5
    Core-->>Agent: 返回标准化混合结果集 (包含来源标识, 标题, slug, 预览)

    %% 场景 2: 按需读取
    Agent->>Core: CallTool: kb_read (slug="gitlab:12345/docs/auth.md")
    Note over Core: 解析 slug 前缀，分配至 GitLabConnector
    Core->>GL: 读取 ("docs/auth.md")
    GL->>Remote: GET Raw File (URL 编码路径)
    Remote-->>GL: 返回原始 Markdown 文本
    Note over GL: 文本保留于内存中，严禁写入本地 fs
    GL-->>Core: 返回 Raw 文本
    Core-->>Agent: 返回 Markdown 内容
```

---

## 4. 业务与功能需求 (Functional Requirements)

### 4.1 连接器模型设计 (Connector Architecture)
为了保证多平台扩展的高内聚低耦合，底层必须采用面向对象设计。
*   抽象出公共的基类/接口 `BaseConnector`，定义如下标准方法：
    *   `search(query: string, limit: number): Promise<SearchResult[]>`：执行全文搜索。
    *   `read(filePath: string): Promise<string>`：读取具体文件内容。
    *   `list(): Promise<TreeItem[]>`：枚举当前仓库下的所有文件结构。
*   实现具体连接器子类 `GitLabConnector` 与 `AzureDevOpsConnector`，分别处理各自的 REST API 鉴权、响应结构转换、以及独立的内存 Fallback 降级逻辑。

### 4.2 统一联合检索接口 (`kb_search`)
*   **需求描述**：提供一个对外的多源合并全文检索接口，Agent 发起后能同时覆盖所有配置的源和仓库。
*   **具体要求**：
    *   **多源并发请求**：并发向所有配置的连接器发起查询，防止单个连接器的报错导致整个检索逻辑中断。
    *   **防阻塞超时控制**：为每个连接器配属底层的 `AbortController`，设定最大超时限制为 **8000ms**，超时则立即放弃该连接器的返回结果并作为失败项隔离。
    *   **重排序与去重 (Rerank)**：根据不同源接口返回的置信度分值（Score）以及本地匹配热度进行规整和降序排列，去除重复项，截取关联度最高的前 5 项（Top-5）。
    *   **单源降级兼容**：当仅配置了单个 GitLab 或 Azure DevOps 仓库时，本接口应表现得与单源全文检索一致。
    *   **参数与返回值定义**：参考第 6 节接口定义。

### 4.3 统一按需读取接口 (`kb_read`)
*   **需求描述**：根据带有源前缀的唯一路径标识，将指定的远端 Markdown 文件 Raw 文本实时拉取至运行内存中。
*   **具体要求**：
    *   **路由解析机制**：对入参 `slug` 采用前缀解析机制。比如 `gitlab:12345/docs/api.md` 路由给 GitLab 连接器 12345，而 `azure:myProj/spec.md` 路由给 Azure DevOps 连接器。
    *   **“零落盘”原则**：数据仅保存在 JS 运行环境内存中。**绝对禁止使用本地临时目录或高速缓存文件写入磁盘**。
    *   **安全路径编码**：连接器在请求 raw 接口前，必须自动将传入的相对路径进行 URL 安全编码。

### 4.4 目录感知与树形枚举 (`kb_list`)
*   **需求描述**：并发枚举所有配置仓库下满足过滤要求的 Markdown 文件列表，使得 Agent 能够对其建立索引或整体认知。
*   **具体要求**：
    *   **自动分页处理**：系统需具备自动分页处理能力（如每次拉取 `per_page=100`，遍历 `page++` 直至没有更多数据）。
    *   **类型过滤**：在内存中过滤，仅收集类型为文件且以 `.md` 结尾的信息。

### 4.5 全内存 Fallback 降级检索服务
*   **需求描述**：当在线搜索 API 不可用（如接口返回 HTTP 500、403 或超时）时，自动触发全内存态降级搜索。
*   **具体要求**：
    *   **自动静默降级**：当连接器在发起在线搜索捕获到特定异常，或者配置显式指定了 `FALLBACK_MODE=true` 时，静默触发降级。
    *   **内存解压**：请求远端归档下载接口，下载分支的 `zip` 包至内存 Buffer，并使用 `adm-zip` 在内存中解压缩。**决不允许在物理解包文件落地**。
    *   **内存模糊检索 (RAM Fuzzy Search)**：过滤出 `subDir` 下的 `.md` 文件，将文本内容导入 `Fuse.js` 模糊搜索引擎中构建轻量级本地内存索引，计算搜索分值并提取匹配片段。
    *   **时间窗口与缓存控制**：设置缓存生存时间（TTL）为 **10分钟**，在缓存期内，重复搜索将直接走内存检索；超出 TTL 时，后续搜索将重新请求打包下载以完成内存索引的同步。

---

## 5. 非功能需求 (Non-Functional Requirements)

### 5.1 安全性与合规性 (最高优先级)
*   **无盘化原则 (Stateless)**：运行期间，本地不允许执行任何文件创建写入物理磁盘的操作。所有敏感内容在内存变量中转完毕后即刻由 Node.js 垃圾回收器（GC）自动释放。
*   **凭证安全硬隔离**：
    *   敏感凭证 Token 必须通过环境变量或本地不纳入版本控制的 `.env` / `config.private.json` 文件传递，严禁硬编码。
    *   生成的 README、配置文件、代码注释及调试日志中**绝对不允许包含特定开发机本地用户名及本地绝对路径**（如 `/Users/...`）。

### 5.2 性能与并发控制
*   **低延迟体验**：在线 API 模式下，联合搜索的平均响应时间需控制在 **2000ms** 以内；在 Fallback 内存解压模式下，除首次拉取打包包会有约 **3s - 5s** 的初始化索引开销外，后续的内存搜索响应必须控制在 **200ms** 以内。
*   **内存配额限制**：为防止过大的归档包撑爆本地 Node.js 内存，系统应对下载的 zip 大小设置阈值，超出 **50MB** 的远端压缩包应抛出错误并提示配置细化的 `subDir` 来收窄抓取范围。

### 5.3 开发标准
*   **技术栈约束**：Node.js 24.11+，采用 `PNPM` 包管理工具，优先使用阿里 Registry 镜像源拉取依赖。
*   **开发标准**：遵循 SOLID 软件工程设计原则，采用 TypeScript 强类型编写，保证核心连接器的模块化，代码注释使用简体中文。

---

## 6. 接口与配置协议说明

### 6.1 配置文件与环境变量
对于单源极简配置，系统支持从根目录 `.env` 加载变量：
```bash
GITLAB_URL=https://gitlab.company.com
GITLAB_PROJECT_ID=12345
GITLAB_TOKEN=glpat-XXXXXXX_exampleToken
GITLAB_BRANCH=main
WIKI_SUBDIR=docs
```

对于多源多仓库联合配置，系统支持加载私有配置文件 `config.private.json`（需被加入 `.gitignore`）：
```json
{
  "timeoutMs": 8000,
  "sources": [
    {
      "type": "gitlab",
      "id": "gitlab_primary",
      "url": "https://gitlab.company.com",
      "projectId": "12345",
      "token": "glpat-XXXXXXX_exampleToken",
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
      "token": "azpat-YYYYYYY_exampleToken",
      "branch": "master",
      "subDir": "standards",
      "fallbackMode": "force"
    }
  ]
}
```

### 6.2 接口映射表

| 注册 Tool 名称 | 输入参数结构 | 返回值结构 (JSON) | 描述 |
| :--- | :--- | :--- | :--- |
| `kb_search` | `{ query: string, limit?: number }` | `Array<{ source: string, repoIdentifier: string, title: string, slug: string, preview: string }>` | 对 GitLab 和 Azure DevOps 进行并发联合全文检索与 Rerank，自动应用 Fallback 降级。 |
| `kb_read` | `{ slug: string }` | `string` (Markdown Plain Text) | 解析 `slug` 前缀，路由分发至对应仓库连接器，实时读取在线 Raw 数据，零物理落盘。 |
| `kb_list` | `{}` | `Array<{ source: string, repoIdentifier: string, title: string, slug: string }>` | 并发枚举所有仓库下可读取的 Markdown 文件列表，方便 AI 建立对整个本地知识库的目录感知。 |
