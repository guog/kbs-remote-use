import axios, { AxiosInstance } from 'axios';
import { BaseConnector, SearchResult, TreeItem } from './BaseConnector.js';
import { MemorySearchIndex } from '../utils/MemorySearchIndex.js';

export class GitLabConnector extends BaseConnector {
  public readonly projectId: string;
  private readonly branch: string;
  private readonly fallbackMode: 'auto' | 'force' | 'none';
  private readonly client: AxiosInstance;
  private searchIndex: MemorySearchIndex | null = null;

  constructor(config: {
    id: string;
    url: string;
    projectId: string;
    token: string;
    branch?: string;
    subDir?: string;
    fallbackMode?: 'auto' | 'force' | 'none';
  }) {
    super(config.id, 'gitlab', config.subDir || '');
    this.projectId = config.projectId;
    this.branch = config.branch || 'main';
    this.fallbackMode = config.fallbackMode || 'auto';

    // Set up axios instance
    const baseUrlNormalized = config.url.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: baseUrlNormalized,
      headers: {
        'Private-Token': config.token,
      },
    });
  }

  private async getOrInitializeIndex(signal?: AbortSignal): Promise<MemorySearchIndex> {
    const TTL = 10 * 60 * 1000; // 10 minutes
    if (this.searchIndex && (Date.now() - this.searchIndex.createdAt < TTL)) {
      return this.searchIndex;
    }

    try {
      const url = `/api/v4/projects/${this.projectId}/repository/archive.zip`;
      const response = await this.client.get(url, {
        params: { 
          sha: this.branch, 
          path: this.subDir || undefined 
        },
        responseType: 'arraybuffer',
        maxContentLength: 50 * 1024 * 1024, // 50MB safety limit
        signal,
      });

      const buffer = Buffer.from(response.data);
      this.searchIndex = new MemorySearchIndex(buffer, this.subDir);
      return this.searchIndex;
    } catch (error: any) {
      if (error.code === 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED' || (error.response && error.response.status === 413)) {
        throw new Error(
          `Repository ZIP archive exceeds 50MB limit for source '${this.id}'. Please configure a narrower subDir.`
        );
      }
      throw new Error(`Failed to initialize memory index for GitLab '${this.id}': ${error.message}`);
    }
  }

  private async searchFallback(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const index = await this.getOrInitializeIndex(signal);
    const results = index.search(query, limit);
    return results.map(res => ({
      source: this.id,
      repoIdentifier: this.projectId,
      title: res.filePath,
      slug: `${this.id}:${res.filePath}`,
      preview: res.preview,
      score: res.score,
    }));
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
    if (this.fallbackMode === 'force') {
      return this.searchFallback(query, limit, signal);
    }

    try {
      // In online search, search in project blobs
      const response = await this.client.get(`/api/v4/projects/${this.projectId}/search`, {
        params: {
          scope: 'blobs',
          search: query,
        },
        signal,
      });

      const items = response.data;
      if (!Array.isArray(items)) {
        throw new Error('Invalid response from GitLab search API');
      }

      const normSubDir = this.subDir ? this.subDir.replace(/^\/|\/$/g, '') : '';

      const filteredItems = items.filter((item: any) => {
        const isMd = item.path.toLowerCase().endsWith('.md');
        if (!isMd) return false;
        if (normSubDir) {
          return item.path === normSubDir || item.path.startsWith(normSubDir + '/');
        }
        return true;
      });

      // Map to SearchResult
      const results: SearchResult[] = filteredItems.slice(0, limit).map((item: any) => {
        // Calculate basic score relevance based on match count in the data preview snippet
        const snippet = item.data || '';
        const regex = new RegExp(query, 'gi');
        const matchCount = (snippet.match(regex) || []).length;
        const score = 1.0 + matchCount * 0.1;

        return {
          source: this.id,
          repoIdentifier: this.projectId,
          title: item.path,
          slug: `${this.id}:${item.path}`,
          preview: snippet.replace(/\r?\n/g, ' '),
          score,
        };
      });

      return results;
    } catch (error: any) {
      if (this.fallbackMode === 'auto') {
        console.warn(`Online search failed for GitLab connector '${this.id}', falling back to memory ZIP index:`, error.message);
        return this.searchFallback(query, limit);
      }
      throw error;
    }
  }

  async read(filePath: string): Promise<string> {
    if (this.fallbackMode === 'force' && this.searchIndex) {
      const content = this.searchIndex.getFileContent(filePath);
      if (content !== null) return content;
    }

    try {
      const encodedPath = encodeURIComponent(filePath);
      const url = `/api/v4/projects/${this.projectId}/repository/files/${encodedPath}/raw`;
      const response = await this.client.get(url, {
        params: { ref: this.branch },
        responseType: 'text',
      });
      return response.data;
    } catch (error: any) {
      if (this.fallbackMode !== 'none') {
        console.warn(`Online file read failed for GitLab path '${filePath}', falling back to memory ZIP index:`, error.message);
        const index = await this.getOrInitializeIndex();
        const content = index.getFileContent(filePath);
        if (content !== null) return content;
      }
      throw error;
    }
  }

  async list(): Promise<TreeItem[]> {
    if (this.fallbackMode === 'force') {
      const index = await this.getOrInitializeIndex();
      return index.getFiles().map(f => ({
        source: this.id,
        repoIdentifier: this.projectId,
        title: f.filePath,
        slug: `${this.id}:${f.filePath}`,
      }));
    }

    try {
      let page = 1;
      let allItems: any[] = [];
      const normSubDir = this.subDir ? this.subDir.replace(/^\/|\/$/g, '') : '';

      while (true) {
        const response = await this.client.get(`/api/v4/projects/${this.projectId}/repository/tree`, {
          params: {
            recursive: true,
            ref: this.branch,
            per_page: 100,
            page: page,
            path: normSubDir || undefined,
          },
        });

        const items = response.data;
        if (!Array.isArray(items) || items.length === 0) {
          break;
        }

        allItems = allItems.concat(items);
        if (items.length < 100) {
          break;
        }
        page++;
      }

      return allItems
        .filter(item => {
          const isBlob = item.type === 'blob';
          const isMd = item.path.toLowerCase().endsWith('.md');
          if (!isBlob || !isMd) return false;
          if (normSubDir) {
            return item.path === normSubDir || item.path.startsWith(normSubDir + '/');
          }
          return true;
        })
        .map(item => ({
          source: this.id,
          repoIdentifier: this.projectId,
          title: item.path,
          slug: `${this.id}:${item.path}`,
        }));
    } catch (error: any) {
      if (this.fallbackMode !== 'none') {
        console.warn(`Online list tree failed for GitLab connector '${this.id}', falling back to memory ZIP index:`, error.message);
        const index = await this.getOrInitializeIndex();
        return index.getFiles().map(f => ({
          source: this.id,
          repoIdentifier: this.projectId,
          title: f.filePath,
          slug: `${this.id}:${f.filePath}`,
        }));
      }
      throw error;
    }
  }
}
