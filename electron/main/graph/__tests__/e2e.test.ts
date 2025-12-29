import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VerbOSGraph } from '../VerbOSGraph';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

// E2E Integration tests using the REAL VerbOSGraph
// These tests will use the real Gemini API (via GOOGLE_API_KEY)
// and real local persistence.

describe('E2E Worker Integration', () => {
  let db: Database.Database;
  let graph: VerbOSGraph;
  const threadId = 'test-thread-' + randomUUID();
  const testDir = join(homedir(), 'verbos-e2e-' + randomUUID());

  beforeEach(async () => {
    // Ensure API Key exists for E2E
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required for E2E tests');
    }

    // Initialize real in-memory DB for checkpointer
    db = new Database(':memory:');
    graph = new VerbOSGraph(db);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    db.close();
    await rm(testDir, { recursive: true, force: true });
  });

  it('should handle a multi-step request: list -> write -> read', async () => {
    // 1. List files (Safe)
    let finalResponse = '';
    for await (const event of graph.stream(threadId, `List the files in ${testDir.replace(/\\/g, '/')}`)) {
      if (event.type === 'complete') {
        finalResponse = event.data.response;
      }
    }
    expect(finalResponse).toBeDefined();

    // 2. Write a file (Sensitive - Needs HITL)
    const fileName = 'e2e_test.txt';
    const filePath = join(testDir, fileName);
    let approvalAction: any = null;

    for await (const event of graph.stream(threadId, `Create a file named ${fileName} in ${testDir.replace(/\\/g, '/')} with content 'E2E Success'`)) {
      if (event.type === 'approval_required') {
        approvalAction = event.data.action;
      }
    }

    expect(approvalAction).not.toBeNull();
    expect(approvalAction.toolName).toBe('write_file');

    // Approve and Resume
    await graph.approveAction(threadId);
    
    for await (const event of graph.stream(threadId, '')) {
      if (event.type === 'complete') {
        finalResponse = event.data.response;
      }
    }

    // Verify file exists
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('E2E Success');

    // 3. Read the file back (Safe)
    for await (const event of graph.stream(threadId, `What is in the file ${filePath.replace(/\\/g, '/')}?`)) {
      if (event.type === 'complete') {
        finalResponse = event.data.response;
      }
    }
    expect(finalResponse.toLowerCase()).toContain('e2e success');
  }, 60000); // Higher timeout for real API calls
});
