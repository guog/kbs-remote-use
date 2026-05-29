import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { GitLabConnector } from './connectors/GitLabConnector.js';
import { AzureDevOpsConnector } from './connectors/AzureDevOpsConnector.js';
import { BaseConnector } from './connectors/BaseConnector.js';

// 1. Load config and instantiate connectors
const config = loadConfig();
const connectors: BaseConnector[] = [];

for (const source of config.sources) {
  if (source.type === 'gitlab') {
    if (!source.projectId) {
      console.error(`Skipping source '${source.id}': projectId is required for gitlab source type.`);
      continue;
    }
    connectors.push(
      new GitLabConnector({
        id: source.id,
        url: source.url,
        projectId: source.projectId,
        token: source.token,
        branch: source.branch,
        subDir: source.subDir,
        fallbackMode: source.fallbackMode,
      })
    );
  } else if (source.type === 'azure-devops') {
    if (!source.projectName) {
      console.error(`Skipping source '${source.id}': projectName is required for azure-devops source type.`);
      continue;
    }
    connectors.push(
      new AzureDevOpsConnector({
        id: source.id,
        url: source.url,
        projectName: source.projectName,
        repoId: source.repoId,
        token: source.token,
        branch: source.branch,
        subDir: source.subDir,
        fallbackMode: source.fallbackMode,
      })
    );
  } else {
    console.error(`Unknown source type: ${(source as any).type}`);
  }
}

console.error(`Initialized ${connectors.length} connectors for multi-source MCP server.`);

// Helper to resolve connector and relative path from slug
export function resolveConnectorAndPath(
  slug: string,
  connectorsList: BaseConnector[]
): { connector: BaseConnector; filePath: string } | null {
  const colonIdx = slug.indexOf(':');
  if (colonIdx === -1) {
    return null;
  }
  const prefix = slug.substring(0, colonIdx); // e.g. "gitlab_primary" or "gitlab"
  const rest = slug.substring(colonIdx + 1);    // e.g. "docs/api.md" or "12345/docs/api.md"

  // Case 1: Prefix is exactly a connector ID
  let connector = connectorsList.find(c => c.id === prefix);
  if (connector) {
    return { connector, filePath: rest };
  }

  // Case 2: Prefix is a connector type (e.g. "gitlab" or "azure" or "azure-devops"), 
  // and the rest starts with the project identifier followed by '/'
  const slashIdx = rest.indexOf('/');
  if (slashIdx !== -1) {
    const identifier = rest.substring(0, slashIdx); // e.g. "12345" or "myProj"
    const filePath = rest.substring(slashIdx + 1);    // e.g. "docs/api.md" or "spec.md"

    connector = connectorsList.find(c => {
      const typeMatch = c.type === prefix || (prefix === 'azure' && c.type === 'azure-devops');
      if (!typeMatch) return false;

      if (c instanceof GitLabConnector) {
        return c.projectId === identifier;
      } else if (c instanceof AzureDevOpsConnector) {
        return c.repositoryId === identifier;
      }
      return false;
    });

    if (connector) {
      return { connector, filePath };
    }
  }

  return null;
}

// 2. Initialize MCP Server
const server = new Server(
  {
    name: 'kbs-remote-use',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Tool List Handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'kb_search',
        description: '对已配置的 GitLab 和 Azure DevOps 仓库进行并发联合全文检索与去重重排序，支持内存 Fallback 降级机制。',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '检索关键字',
            },
            limit: {
              type: 'number',
              description: '最大返回结果数 (默认 5)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'kb_read',
        description: '根据唯一路径标识 (slug)，实时读取在线 Markdown 原始文本，零物理落盘。',
        inputSchema: {
          type: 'object',
          properties: {
            slug: {
              type: 'string',
              description: '路由标识 (格式如 \'gitlab_primary:docs/api.md\')',
            },
          },
          required: ['slug'],
        },
      },
      {
        name: 'kb_list',
        description: '并发枚举所有已配置仓库下的 Markdown 文件列表，建立目录结构感知。',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Register Tool Call Handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;

  if (toolName === 'kb_search') {
    const query = request.params.arguments?.query;
    if (typeof query !== 'string') {
      throw new Error('Invalid query argument');
    }
    const limit = Number(request.params.arguments?.limit ?? 5);

    // Concurrently search all repositories with a timeout abort controller
    const searchPromises = connectors.map(async (connector) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, config.timeoutMs);

      try {
        const results = await connector.search(query, limit, controller.signal);
        return results;
      } catch (err: any) {
        console.error(`Search error on connector '${connector.id}':`, err.message);
        return []; // Suppress and isolate error to allow other connectors to succeed
      } finally {
        clearTimeout(timeoutId);
      }
    });

    const settled = await Promise.allSettled(searchPromises);
    const combinedResults = [];

    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      if (res.status === 'fulfilled') {
        combinedResults.push(...res.value);
      }
    }

    // Rerank and deduplicate
    // Sort by score in descending order (higher score first)
    const sorted = combinedResults.sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const deduplicated = [];

    for (const item of sorted) {
      if (!seen.has(item.slug)) {
        seen.add(item.slug);
        deduplicated.push({
          source: item.source,
          repoIdentifier: item.repoIdentifier,
          title: item.title,
          slug: item.slug,
          preview: item.preview,
        });
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(deduplicated.slice(0, limit), null, 2),
        },
      ],
    };
  }

  if (toolName === 'kb_read') {
    const slug = request.params.arguments?.slug;
    if (typeof slug !== 'string') {
      throw new Error('Invalid slug argument');
    }

    const resolved = resolveConnectorAndPath(slug, connectors);
    if (!resolved) {
      throw new Error(`Could not resolve connector for slug: '${slug}'`);
    }

    const { connector, filePath } = resolved;
    const content = await connector.read(filePath);

    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  }

  if (toolName === 'kb_list') {
    // Concurrently enumerate trees from all connectors
    const listPromises = connectors.map(async (connector) => {
      try {
        return await connector.list();
      } catch (err: any) {
        console.error(`List error on connector '${connector.id}':`, err.message);
        return [];
      }
    });

    const settled = await Promise.allSettled(listPromises);
    const combinedList = [];

    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      if (res.status === 'fulfilled') {
        combinedList.push(...res.value);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(combinedList, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${toolName}`);
});

// Start Server on Stdio Transport
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Multi-Source Stateless MCP Server running on stdio.');
}

run().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
