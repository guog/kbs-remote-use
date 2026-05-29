import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env if present
dotenv.config();

export interface SourceConfig {
  type: 'gitlab' | 'azure-devops';
  id: string;
  url: string;
  token: string;
  branch?: string;
  subDir?: string;
  fallbackMode?: 'auto' | 'force' | 'none';

  // GitLab specific
  projectId?: string;

  // Azure DevOps specific
  projectName?: string;
  repoId?: string;
}

export interface AppConfig {
  timeoutMs: number;
  sources: SourceConfig[];
}

export function loadConfig(workspaceRoot: string = process.cwd()): AppConfig {
  const configPath = path.join(workspaceRoot, 'config.private.json');
  
  let appConfig: Partial<AppConfig> = {};

  // 1. Try loading from config.private.json
  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      appConfig = JSON.parse(fileContent);
    } catch (error) {
      console.error('Error parsing config.private.json:', error);
    }
  }

  // Set default timeout
  const timeoutMs = appConfig.timeoutMs ?? 8000;
  const sources: SourceConfig[] = appConfig.sources ?? [];

  // 2. If no sources loaded from JSON, fallback to env variables
  if (sources.length === 0) {
    const gitlabUrl = process.env.GITLAB_URL;
    const gitlabProjectId = process.env.GITLAB_PROJECT_ID;
    const gitlabToken = process.env.GITLAB_TOKEN;

    if (gitlabUrl && gitlabProjectId && gitlabToken) {
      sources.push({
        type: 'gitlab',
        id: 'gitlab',
        url: gitlabUrl,
        projectId: gitlabProjectId,
        token: gitlabToken,
        branch: process.env.GITLAB_BRANCH || 'main',
        subDir: process.env.WIKI_SUBDIR || '',
        fallbackMode: (process.env.FALLBACK_MODE as 'auto' | 'force' | 'none') || 'auto',
      });
    }
  }

  return {
    timeoutMs,
    sources,
  };
}
