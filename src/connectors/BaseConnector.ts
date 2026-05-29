export interface SearchResult {
  source: string;          // Source configuration ID (e.g. "gitlab_primary")
  repoIdentifier: string;  // Repository identifier (e.g. "12345" or "myProj")
  title: string;           // File title / relative path
  slug: string;            // Route slug (e.g. "gitlab_primary:docs/api.md")
  preview: string;         // Match preview snippet
  score: number;           // Relevancy score (higher is better)
}

export interface TreeItem {
  source: string;
  repoIdentifier: string;
  title: string;
  slug: string;
}

export abstract class BaseConnector {
  public readonly id: string;
  public readonly type: string;
  public readonly subDir: string;

  constructor(id: string, type: string, subDir: string) {
    this.id = id;
    this.type = type;
    this.subDir = subDir ? subDir.replace(/^\/|\/$/g, '') : ''; // normalize to remove leading/trailing slashes
  }

  /**
   * Execute full-text search across files in the repository.
   * @param query Search query keyword
   * @param limit Maximum results to return
   * @param signal Optional abort signal for timeout cancellation
   */
  abstract search(query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]>;

  /**
   * Retrieve file contents in memory without storing it on disk.
   * @param filePath Relative path of the file
   */
  abstract read(filePath: string): Promise<string>;

  /**
   * List all Markdown files in the repository recursively.
   */
  abstract list(): Promise<TreeItem[]>;
}
