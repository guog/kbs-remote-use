import AdmZip from 'adm-zip';
import Fuse from 'fuse.js';

export interface IndexedFile {
  filePath: string;  // Relative file path inside the repo (excluding the common archive root)
  content: string;   // Full raw file content
  title: string;     // Title or filename
}

export class MemorySearchIndex {
  private files: IndexedFile[] = [];
  private fuse: Fuse<IndexedFile> | null = null;
  public readonly createdAt: number;

  constructor(zipBuffer: Buffer, subDir: string) {
    this.createdAt = Date.now();
    this.initialize(zipBuffer, subDir);
  }

  private initialize(zipBuffer: Buffer, subDir: string) {
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();
    
    // 1. Filter out directory entries
    const fileEntries = zipEntries.filter(entry => !entry.isDirectory);
    if (fileEntries.length === 0) return;

    // 2. Identify if there's a common root directory (e.g., repository-main-sha/)
    const entryPathSegments = fileEntries.map(f => f.entryName.split('/'));
    let hasCommonRoot = true;
    const firstSegment = entryPathSegments[0][0];
    
    if (!firstSegment) {
      hasCommonRoot = false;
    } else {
      for (const segments of entryPathSegments) {
        if (segments.length < 2 || segments[0] !== firstSegment) {
          hasCommonRoot = false;
          break;
        }
      }
    }

    // Normalize subDir (e.g., "docs" or "standards")
    const normSubDir = subDir ? subDir.replace(/^\/|\/$/g, '') : '';

    // 3. Process entries and extract matching markdown files
    for (let i = 0; i < fileEntries.length; i++) {
      const entry = fileEntries[i];
      const segments = entryPathSegments[i];
      
      // Determine relative path: strip common root only if it is not the subdirectory itself
      let relPath = entry.entryName;
      if (hasCommonRoot) {
        if (firstSegment !== normSubDir) {
          relPath = segments.slice(1).join('/');
        }
      }

      // Filter by markdown extension
      if (!relPath.toLowerCase().endsWith('.md')) {
        continue;
      }

      // Filter by subdirectory if configured
      if (normSubDir) {
        const isInSubDir = relPath === normSubDir || relPath.startsWith(normSubDir + '/');
        if (!isInSubDir) continue;
      }

      try {
        const content = entry.getData().toString('utf-8');
        this.files.push({
          filePath: relPath,
          content,
          title: pathBasename(relPath),
        });
      } catch (err) {
        console.error(`Error reading ZIP entry ${entry.entryName}:`, err);
      }
    }

    // 4. Initialize Fuse.js for fuzzy search
    this.fuse = new Fuse(this.files, {
      keys: ['title', 'content', 'filePath'],
      includeMatches: false,
      includeScore: true,
      threshold: 0.4,
      ignoreLocation: true,
    });
  }

  public search(query: string, limit: number) {
    if (!this.fuse) return [];
    const results = this.fuse.search(query);
    
    return results.slice(0, limit).map(res => {
      const { item, score } = res;
      // Fuse.js score: 0 is perfect match, 1 is no match. Normalize: 1 is perfect match, 0 is no match.
      const normalizedScore = 1 - (score ?? 1);
      
      return {
        filePath: item.filePath,
        title: item.title,
        content: item.content,
        score: normalizedScore,
        preview: extractPreview(item.content, query),
      };
    });
  }

  public getFiles(): IndexedFile[] {
    return this.files;
  }

  public getFileContent(filePath: string): string | null {
    // Normalize path to prevent absolute path or path traversal matching issues
    const normalizedTarget = filePath.replace(/^\/|\/$/g, '');
    const found = this.files.find(f => f.filePath === normalizedTarget);
    return found ? found.content : null;
  }
}

function pathBasename(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

function extractPreview(content: string, query: string): string {
  if (!query) {
    return content.substring(0, 150);
  }
  const index = content.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) {
    return content.substring(0, 150);
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + query.length + 90);
  let snippet = content.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  return snippet.replace(/\r?\n/g, ' '); // Flatten newlines for clean preview display
}
