# 项目技术文档规范 (Docs Overview)

本目录用于统一托管本项目的核心产品规划（PRDs）、技术架构演进提案（RFCs）以及关键的架构决策历史记录（ADRs）。所有文档均采用 Markdown 格式，并严格遵循版本化与规范化的编号体系。

为了让后续团队开发更标准化，所有类型的文档均已配有统一模板。**依据社区最佳实践，模板文件自身不参与流水号排号**，以保证业务文档能正常从 `001` 开始排列。

---

## 📂 目录结构与规范定位

```bash
docs/
├── README.md               # 本指南 (文档结构说明与编号规范)
├── prds/                   # 产品需求文档目录 (Product Requirement Documents)
│   ├── template.md         # PRD 需求文档编写模板 (不编号)
│   └── prd-001-multi-source-stateless-mcp.md # 多源无盘知识检索系统 PRD (001 开始)
├── rfcs/                   # 技术演进提案目录 (Request for Comments)
│   ├── README.md           # RFC 目录使用规范
│   ├── template.md         # 团队 RFC 编写模板与规范 (不编号)
│   └── rfc-002-multi-source-mcp-design.md # 多源检索详细技术设计提案 (002 开始)
└── adrs/                   # 架构决策记录目录 (Architecture Decision Records)
    ├── template.md         # ADR 架构决策编写模板 (不编号)
    ├── adr-001-mcp-vs-skill-integration.md # 编码 Agent 接入技术选型决策记录实例 (001 开始)
    └── adr-002-multi-source-mcp-implementation.md # 多源无盘知识检索系统实现决议 (002 开始)
```

*   **`prds/` (产品/业务需求 - 做什么 - WHAT)**：
    定义系统的高层产品边界、用户痛点、业务场景、Tool 输出接口及非功能性合规要求。**不包含具体的技术实现细节**。
*   **`rfcs/` (技术方案设计 - 怎么做 - HOW)**：
    描述具体的系统设计与技术实现。包括要调用的具体 API 地址、参数结构、底层解压缩方案及并发调度策略等细节。
*   **`adrs/` (架构决策记录 - 为什么这么做 - WHY)**：
    记录项目在演进过程中，针对关键技术选型（如：MCP 还是 Skill、选择何种数据库等）做出的**最终技术决议及其权衡历史背景**。一旦采纳便成为系统不可篡改的历史事实。

---

## 🏷️ 文档命名与编号规则

实体文档统一采用 `[类型]-[三位编号]-[简短英文描述].md` 的小写短横线命名法。

### 1. PRDs 命名规则
*   **编写模板**：[template.md](prds/template.md)
*   **实例项目**：[prd-001-gitlab-wiki-stateless-mcp.md](prds/prd-001-gitlab-wiki-stateless-mcp.md)

### 2. RFCs 命名规则
*   **编写模板**：[template.md](rfcs/template.md)
*   **设计提案**：[rfc-002-multi-source-mcp-design.md](rfcs/rfc-002-multi-source-mcp-design.md)

### 3. ADRs 命名规则
*   **编写模板**：[template.md](adrs/template.md)
*   **实例项目**：[adr-001-mcp-vs-skill-integration.md](adrs/adr-001-mcp-vs-skill-integration.md)

---

## 🔄 文档流转与开发流程

在后续的开发演进中，建议遵循以下软件工程最佳实践：
1.  **需求捕获**：使用 [template.md](prds/template.md) 模板起草 PRD，编号从 `001` 开始。
2.  **方案设计与讨论**：使用 [template.md](rfcs/template.md) 模板起草 RFC 提案。
3.  **技术决策归档**：使用 [template.md](adrs/template.md) 模板起草 ADR 决策并归档，编号从 `001` 开始。
4.  **编码开发**：最后进行具体的代码编码开发。
