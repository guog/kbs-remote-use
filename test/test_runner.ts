import AdmZip from 'adm-zip';
import { GitLabConnector } from '../src/connectors/GitLabConnector.js';
import { AzureDevOpsConnector } from '../src/connectors/AzureDevOpsConnector.js';
import { resolveConnectorAndPath } from '../src/index.js';

// Simple Assertion Helpers
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function assertEquals(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    throw new Error(`Assertion Failed: ${message}. Expected '${expected}', but got '${actual}'`);
  }
}

// Generate a dummy ZIP buffer for testing fallback ZIP unpacking
function generateGitLabTestZip(): Buffer {
  const zip = new AdmZip();
  // GitLab archive contains a root dir (e.g., project-main-1234/)
  zip.addFile('project-main-1234/docs/api.md', Buffer.from('# API Guidelines\nUse JWT authentication tokens for signing requests.'));
  zip.addFile('project-main-1234/docs/style.md', Buffer.from('# Style Guidelines\nCode in camelCase. No tabs.'));
  zip.addFile('project-main-1234/other.txt', Buffer.from('No markdown file.'));
  return zip.toBuffer();
}

function generateAzureTestZip(): Buffer {
  const zip = new AdmZip();
  // Azure DevOps archive can start directly or have a root folder. Let's test starting directly.
  zip.addFile('standards/deploy.md', Buffer.from('# Deployment Standards\nDeploy to multi-cloud environments using Kubernetes.'));
  zip.addFile('standards/auth.md', Buffer.from('# Authentication standards\nToken-based signing and verification details.'));
  return zip.toBuffer();
}

async function runTests() {
  console.log('🚀 Starting Multi-Source Stateless MCP Server Tests...\n');

  // Test Case 1: Slug Parsing and Routing Resolution
  console.log('📋 Test Case 1: Slug Routing Resolution');
  {
    const dummyGitLab = new GitLabConnector({
      id: 'gitlab_primary',
      url: 'https://gitlab.example.com',
      projectId: '12345',
      token: 'token123',
    });

    const dummyAzure = new AzureDevOpsConnector({
      id: 'azure_secondary',
      url: 'https://dev.azure.com/org',
      projectName: 'CorePlatform',
      repoId: '98765',
      token: 'token456',
    });

    const list = [dummyGitLab, dummyAzure];

    // Case 1.1: Direct ID Match
    const res1 = resolveConnectorAndPath('gitlab_primary:docs/api.md', list);
    assert(res1 !== null, 'Should resolve direct GitLab ID');
    assertEquals(res1?.connector.id, 'gitlab_primary', 'Should map to gitlab_primary');
    assertEquals(res1?.filePath, 'docs/api.md', 'Should extract correct filePath');

    // Case 1.2: Direct ID Match Azure
    const res2 = resolveConnectorAndPath('azure_secondary:standards/deploy.md', list);
    assert(res2 !== null, 'Should resolve direct Azure ID');
    assertEquals(res2?.connector.id, 'azure_secondary', 'Should map to azure_secondary');
    assertEquals(res2?.filePath, 'standards/deploy.md', 'Should extract correct filePath');

    // Case 1.3: Legacy Type:ProjectId Routing
    const res3 = resolveConnectorAndPath('gitlab:12345/docs/auth.md', list);
    assert(res3 !== null, 'Should resolve legacy GitLab project ID mapping');
    assertEquals(res3?.connector.id, 'gitlab_primary', 'Should map to gitlab_primary based on projectId');
    assertEquals(res3?.filePath, 'docs/auth.md', 'Should extract correct filePath');

    // Case 1.4: Legacy Type:ProjectName Routing for Azure
    const res4 = resolveConnectorAndPath('azure:98765/spec.md', list);
    assert(res4 !== null, 'Should resolve legacy Azure project/repo ID mapping');
    assertEquals(res4?.connector.id, 'azure_secondary', 'Should map to azure_secondary based on repositoryId');
    assertEquals(res4?.filePath, 'spec.md', 'Should extract correct filePath');

    // Case 1.5: Unresolved slug
    const res5 = resolveConnectorAndPath('unknown_id:docs/api.md', list);
    assertEquals(res5, null, 'Should return null for unknown IDs');
  }
  console.log('✅ Slug Routing Resolution passed!\n');

  // Test Case 2: GitLabConnector Online Mode
  console.log('📋 Test Case 2: GitLabConnector Online Mode');
  {
    const connector = new GitLabConnector({
      id: 'gl_online',
      url: 'https://gitlab.example.com',
      projectId: '123',
      token: 'pat123',
      subDir: 'docs',
    });

    // Mock Axios client requests
    const mockClient = (connector as any).client;
    mockClient.get = async (url: string, config: any) => {
      if (url.includes('/search')) {
        assertEquals(config.params.scope, 'blobs', 'Search scope should be blobs');
        assertEquals(config.params.search, 'JWT', 'Search query should be JWT');
        return {
          data: [
            {
              path: 'docs/api.md',
              data: 'Line containing JWT authentication token detail.',
            },
            {
              path: 'other/ignored.md',
              data: 'Ignored file out of subDir',
            }
          ]
        };
      }
      if (url.includes('/files/') && url.includes('/raw')) {
        return { data: 'Raw markdown file content' };
      }
      if (url.includes('/repository/tree')) {
        return {
          data: [
            { type: 'blob', path: 'docs/api.md' },
            { type: 'blob', path: 'docs/style.md' },
            { type: 'blob', path: 'other.md' }
          ]
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    // Test Search (with subdirectory filtering)
    const results = await connector.search('JWT', 5);
    assertEquals(results.length, 1, 'Should filter out items outside subDir');
    assertEquals(results[0].title, 'docs/api.md', 'Title should match');
    assertEquals(results[0].slug, 'gl_online:docs/api.md', 'Slug should match format');
    assert(results[0].preview.includes('JWT'), 'Preview should contain matching text');

    // Test Read
    const rawContent = await connector.read('docs/api.md');
    assertEquals(rawContent, 'Raw markdown file content', 'Should read content from mock');

    // Test List (with type filtering and subDir prefix filter)
    const list = await connector.list();
    assertEquals(list.length, 2, 'Should list markdown files under subDir');
    assertEquals(list[0].title, 'docs/api.md', 'First path match');
    assertEquals(list[1].title, 'docs/style.md', 'Second path match');
  }
  console.log('✅ GitLabConnector Online Mode passed!\n');

  // Test Case 3: GitLabConnector Fallback Mode (Memory Zip & Fuse.js)
  console.log('📋 Test Case 3: GitLabConnector Fallback Mode (Memory Zip & Fuse.js)');
  {
    const connector = new GitLabConnector({
      id: 'gl_fallback',
      url: 'https://gitlab.example.com',
      projectId: '123',
      token: 'pat123',
      subDir: 'docs',
      fallbackMode: 'auto',
    });

    const mockClient = (connector as any).client;
    let zipFetched = false;
    mockClient.get = async (url: string, config: any) => {
      if (url.includes('/search')) {
        // Trigger 500 internal server error to force auto-fallback
        throw new Error('500 Internal Server Error (Elasticsearch is down)');
      }
      if (url.includes('/repository/archive.zip')) {
        zipFetched = true;
        assertEquals(config.params.path, 'docs', 'Should download archive restricted to subDir');
        return {
          data: generateGitLabTestZip()
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    // Test Search via Fallback
    const results = await connector.search('JWT', 5);
    assert(zipFetched, 'Should have downloaded the fallback ZIP archive');
    assertEquals(results.length, 1, 'Should find 1 match via Fuse.js');
    assertEquals(results[0].title, 'docs/api.md', 'Should match relative path (stripping root directory)');
    assert(results[0].preview.includes('JWT'), 'Should extract relevant preview from ZIP content');
    assert(results[0].score > 0, 'Relevancy score should be computed');

    // Subsequent search should use cached index (zipFetched should not change)
    zipFetched = false;
    const resultsCached = await connector.search('camelCase', 5);
    assert(!zipFetched, 'Should use in-memory cache without downloading ZIP again');
    assertEquals(resultsCached.length, 1, 'Should find 1 match for camelCase');
    assertEquals(resultsCached[0].title, 'docs/style.md', 'Should match style.md');

    // Test reading file from fallback cache
    const content = await connector.read('docs/api.md');
    assert(content.includes('JWT authentication tokens'), 'Should read file content directly from memory index');
  }
  console.log('✅ GitLabConnector Fallback Mode passed!\n');

  // Test Case 4: AzureDevOpsConnector Online Mode
  console.log('📋 Test Case 4: AzureDevOpsConnector Online Mode');
  {
    const connector = new AzureDevOpsConnector({
      id: 'az_online',
      url: 'https://dev.azure.com/myOrg',
      projectName: 'CorePlatform',
      repoId: 'myRepo',
      token: 'pat456',
      subDir: 'standards',
    });

    const mockClient = (connector as any).client;
    mockClient.post = async (url: string, data: any, config: any) => {
      if (url.includes('/codesearchresults')) {
        assertEquals(data.searchText, 'multi-cloud', 'Search text matches');
        assertEquals(data.filters.Project[0], 'CorePlatform', 'Project filter matches');
        return {
          data: {
            results: [
              {
                fileName: 'deploy.md',
                path: '/standards/deploy.md',
                matches: {
                  content: [
                    { lineContent: 'Deploying to multi-cloud Kubernetes clusters.' }
                  ]
                }
              },
              {
                fileName: 'other.md',
                path: '/wrong-dir/other.md',
                matches: {
                  content: []
                }
              }
            ]
          }
        };
      }
      throw new Error(`Unexpected post request: ${url}`);
    };

    mockClient.get = async (url: string, config: any) => {
      if (url.includes('/items') && config.params.path) {
        return { data: 'Online Azure raw file' };
      }
      if (url.includes('/items') && !config.params.download) {
        return {
          data: {
            value: [
              { path: '/standards/deploy.md', isFolder: false },
              { path: '/standards/auth.md', isFolder: false },
              { path: '/other.md', isFolder: false }
            ]
          }
        };
      }
      throw new Error(`Unexpected get request: ${url}`);
    };

    // Test Search
    const results = await connector.search('multi-cloud', 5);
    assertEquals(results.length, 1, 'Filters out items outside standards/ subDir');
    assertEquals(results[0].title, 'standards/deploy.md', 'Strips leading slash from path');
    assertEquals(results[0].slug, 'az_online:standards/deploy.md', 'Formatted slug matches');

    // Test Read
    const content = await connector.read('standards/deploy.md');
    assertEquals(content, 'Online Azure raw file', 'Should fetch file raw text');

    // Test List
    const list = await connector.list();
    assertEquals(list.length, 2, 'Lists files under subdirectory');
    assertEquals(list[0].title, 'standards/deploy.md', 'Strips leading slash in list');
  }
  console.log('✅ AzureDevOpsConnector Online Mode passed!\n');

  // Test Case 5: AzureDevOpsConnector Fallback Mode
  console.log('📋 Test Case 5: AzureDevOpsConnector Fallback Mode');
  {
    const connector = new AzureDevOpsConnector({
      id: 'az_fallback',
      url: 'https://dev.azure.com/myOrg',
      projectName: 'CorePlatform',
      repoId: 'myRepo',
      token: 'pat456',
      subDir: 'standards',
      fallbackMode: 'force', // Force fallback immediately
    });

    const mockClient = (connector as any).client;
    let zipFetched = false;
    mockClient.get = async (url: string, config: any) => {
      if (url.includes('/items') && config.params.download && config.params.$format === 'zip') {
        zipFetched = true;
        assertEquals(config.params.scopePath, '/standards', 'Downloads ZIP for subDir');
        return {
          data: generateAzureTestZip()
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    // Force fallback should build index on search
    const results = await connector.search('Kubernetes', 5);
    assert(zipFetched, 'ZIP downloaded on force fallback');
    assertEquals(results.length, 1, 'Finds match inside the ZIP');
    assertEquals(results[0].title, 'standards/deploy.md', 'Root path matches properly');
    assert(results[0].preview.includes('Kubernetes'), 'Snippet parsed correctly');

    // Test read from memory
    const content = await connector.read('standards/deploy.md');
    assert(content.includes('Kubernetes'), 'Content matches memory ZIP content');

    // Test list from memory
    const list = await connector.list();
    assertEquals(list.length, 2, 'Returns both files in the ZIP index');
    list.sort((a, b) => a.title.localeCompare(b.title));
    assertEquals(list[0].title, 'standards/auth.md', 'Strips root path in list');
    assertEquals(list[1].title, 'standards/deploy.md', 'Strips root path in list');
  }
  console.log('✅ AzureDevOpsConnector Fallback Mode passed!\n');

  console.log('🎉 All Tests Passed Successfully!');
}

runTests().catch(err => {
  console.error('\n❌ Test Execution Failed:');
  console.error(err);
  process.exit(1);
});
