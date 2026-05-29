import axios, { AxiosInstance } from 'axios';
import { BaseConnector, SearchResult, TreeItem } from './BaseConnector.js';
import { MemorySearchIndex } from '../utils/MemorySearchIndex.js';

export class AzureDevOpsConnector extends BaseConnector {
  public readonly repositoryId: string;
  private readonly projectName: string;
  private readonly branch: string;
  private readonly fallbackMode: 'auto' | 'force' | 'none';
  private readonly client: AxiosInstance;
  private searchIndex: MemorySearchIndex | null = null;

  constructor(config: {
    id: string;
    url: string;
    projectName: string;
    repoId?: string;
    token: string;
    branch?: string;
    subDir?: string;
    fallbackMode?: 'auto' | 'force' | 'none';
  }) {
    super(config.id, 'azure-devops', config.subDir || '');
    this.projectName = config.projectName;
    this.repositoryId = config.repoId || config.projectName;
    this.branch = config.branch || 'master';
    this.fallbackMode = config.fallbackMode || 'auto';

    // Set up basic authentication header
    const tokenBase64 = Buffer.from(`:${config.token}`).toString('base64');
    
    // Normalize base URL to include the organization and project
    const baseUrlNormalized = `${config.url.replace(/\/$/, '')}/${config.projectName}`;
    
    this.client = axios.create({
      baseURL: baseUrlNormalized,
      headers: {
        'Authorization': `Basic ${tokenBase64}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private async getOrInitializeIndex(signal?: AbortSignal): Promise<MemorySearchIndex> {
    const TTL = 10 * 60 * 1000; // 10 minutes
    if (this.searchIndex && (Date.now() - this.searchIndex.createdAt < TTL)) {
      return this.searchIndex;
    }

    try {
      const scopePath = this.subDir ? '/' + this.subDir.replace(/^\//, '') : '/';
      const url = `/_apis/git/repositories/${this.repositoryId}/items`;
      const response = await this.client.get(url, {
        params: {
          scopePath: scopePath,
          recursionLevel: 'full',
          download: true,
          'versionDescriptor.version': this.branch,
          'versionDescriptor.versionType': 'branch',
          '$format': 'zip',
          'api-version': '6.0',
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
      throw new Error(`Failed to initialize memory index for Azure DevOps '${this.id}': ${error.message}`);
    }
  }

  private async searchFallback(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const index = await this.getOrInitializeIndex(signal);
    const results = index.search(query, limit);
    return results.map(res => ({
      source: this.id,
      repoIdentifier: this.repositoryId,
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
      // Azure DevOps Code Search API is relative to the project
      // POST https://dev.azure.com/{org}/{project}/_apis/search/codesearchresults?api-version=6.0-preview.1
      const response = await this.client.post(`/_apis/search/codesearchresults`, {
        searchText: query,
        $top: limit * 2, // fetch slightly more to filter out non-markdown files
        filters: {
          Project: [this.projectName],
          Repository: [this.repositoryId],
        },
      }, {
        params: {
          'api-version': '6.0-preview.1',
        },
        signal,
      });

      const resultsList = response.data?.results;
      if (!Array.isArray(resultsList)) {
        throw new Error('Invalid response from Azure DevOps search API');
      }

      const normSubDir = this.subDir ? this.subDir.replace(/^\/|\/$/g, '') : '';

      const filteredResults = resultsList.filter((item: any) => {
        const cleanPath = item.path.replace(/^\//, '');
        const isMd = cleanPath.toLowerCase().endsWith('.md');
        if (!isMd) return false;
        if (normSubDir) {
          return cleanPath === normSubDir || cleanPath.startsWith(normSubDir + '/');
        }
        return true;
      });

      const results: SearchResult[] = filteredResults.slice(0, limit).map((item: any) => {
        let preview = '';
        if (item.matches && Array.isArray(item.matches.content) && item.matches.content.length > 0) {
          preview = item.matches.content.map((c: any) => c.lineContent || '').join(' ');
        } else {
          preview = item.path;
        }

        // Calculate score
        const regex = new RegExp(query, 'gi');
        const matchCount = (preview.match(regex) || []).length;
        const score = 1.0 + matchCount * 0.1;

        const cleanPath = item.path.replace(/^\//, '');
        return {
          source: this.id,
          repoIdentifier: this.repositoryId,
          title: cleanPath,
          slug: `${this.id}:${cleanPath}`,
          preview: preview.replace(/\r?\n/g, ' '),
          score,
        };
      });

      return results;
    } catch (error: any) {
      if (this.fallbackMode === 'auto') {
        console.warn(`Online search failed for Azure DevOps connector '${this.id}', falling back to memory ZIP index:`, error.message);
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
      const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;
      const response = await this.client.get(`/_apis/git/repositories/${this.repositoryId}/items`, {
        params: {
          path: normalizedPath,
          'versionDescriptor.version': this.branch,
          'versionDescriptor.versionType': 'branch',
          '$format': 'text',
          'api-version': '6.0',
        },
        responseType: 'text',
      });
      return response.data;
    } catch (error: any) {
      if (this.fallbackMode !== 'none') {
        console.warn(`Online file read failed for Azure DevOps path '${filePath}', falling back to memory ZIP index:`, error.message);
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
        repoIdentifier: this.repositoryId,
        title: f.filePath,
        slug: `${this.id}:${f.filePath}`,
      }));
    }

    try {
      const scopePath = this.subDir ? '/' + this.subDir.replace(/^\//, '') : '/';
      const response = await this.client.get(`/_apis/git/repositories/${this.repositoryId}/items`, {
        params: {
          scopePath: scopePath,
          recursionLevel: 'full',
          'versionDescriptor.version': this.branch,
          'versionDescriptor.versionType': 'branch',
          'api-version': '6.0',
        },
      });

      const items = response.data?.value;
      if (!Array.isArray(items)) {
        throw new Error('Invalid response from Azure DevOps items API');
      }

      const normSubDir = this.subDir ? this.subDir.replace(/^\/|\/$/g, '') : '';
      return items
        .filter((item: any) => {
          const isFile = !item.isFolder;
          const isMd = item.path.toLowerCase().endsWith('.md');
          if (!isFile || !isMd) return false;
          const cleanPath = item.path.replace(/^\//, '');
          if (normSubDir) {
            return cleanPath === normSubDir || cleanPath.startsWith(normSubDir + '/');
          }
          return true;
        })
        .map((item: any) => {
          const cleanPath = item.path.replace(/^\//, '');
          return {
            source: this.id,
            repoIdentifier: this.repositoryId,
            title: cleanPath,
            slug: `${this.id}:${cleanPath}`,
          };
        });
    } catch (error: any) {
      if (this.fallbackMode !== 'none') {
        console.warn(`Online list tree failed for Azure DevOps connector '${this.id}', falling back to memory ZIP index:`, error.message);
        const index = await this.getOrInitializeIndex();
        return index.getFiles().map(f => ({
          source: this.id,
          repoIdentifier: this.repositoryId,
          title: f.filePath,
          slug: `${this.id}:${f.filePath}`,
        }));
      }
      throw error;
    }
  }
}
