# RFCs (Request for Comments) 目录说明

本目录用于存放系统设计、架构演进和重大技术改动的征求意见稿（RFC）文档。

## 🏷️ 文档规范

1.  **模板使用**：任何新 RFC 均应基于本目录下的 [template.md](template.md) 模板进行起草。
2.  **命名规则**：统一采用 `rfc-[三位数字]-[英文描述].md` 的小写短横线命名法。
    *   例如：`rfc-001-semantic-search.md`
3.  **编号体系**：遵循数字自增流水号（`001`、`002`...），模板文件本身（`template.md`）不参与编号。

## 🗂️ 文件树说明

*   `template.md`：通用 RFC 征求意见及方案设计标准格式模板。
*   `README.md`：本指南说明文件。

---

## 📌 未来规划的 RFC 主题建议
1.  **RFC-002: 基于 Webhook 的 GitLab 自动推送刷新**
    在 GitLab 仓库配置 Webhook，每当 Wiki Git 提交更新时，自动向 MCP 代理节点广播并刷新运行期内存缓存。
2.  **RFC-003: 接入本地大模型向量化 (Local Embedding RAG)**
    引入轻量级的端侧向量模型（如 ONNX 版本的 BGE-M3），在 Stdio 运行层执行无落地物理文件的语义相似度计算。
