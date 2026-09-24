import crypto from 'node:crypto';
import { DatabaseManager, getTenantContext } from '../../core/src/index.js';

export interface IngestDocumentParams {
  title: string;
  sourceType: 'text' | 'csv' | 'pdf' | 'url';
  content: string;
  url?: string;
  effectiveDate?: string;
  tags?: string[];
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface IngestResult {
  sourceId: string;
  title: string;
  sourceType: string;
  chunkCount: number;
  checksum: string;
  isExisting: boolean;
  effectiveDate: string;
}

export interface KnowledgeSourceSummary {
  id: string;
  tenantId: string;
  title: string;
  sourceType: string;
  url?: string;
  effectiveDate: string;
  chunkCount: number;
  checksum?: string;
  createdAt: string;
}

export class KnowledgeIngestionService {
  constructor(private db: DatabaseManager) {}

  /**
   * Ingest and chunk text, CSV, or document data with automatic deduplication
   */
  public async ingestDocument(params: IngestDocumentParams): Promise<IngestResult> {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();
    const effectiveDate = params.effectiveDate || new Date().toISOString().slice(0, 10);

    // 1. Calculate content checksum to prevent duplicate ingestion
    const checksum = crypto.createHash('sha256').update(params.content.trim()).digest('hex');

    // Check for existing source with same checksum in this tenant
    const existing = rawDb.prepare(`
      SELECT id, title, source_type, effective_date, chunk_count
      FROM knowledge_sources
      WHERE tenant_id = ? AND checksum = ?
    `).get(ctx.tenantId, checksum) as any;

    if (existing) {
      return {
        sourceId: existing.id,
        title: existing.title,
        sourceType: existing.source_type,
        chunkCount: existing.chunk_count || 0,
        checksum,
        isExisting: true,
        effectiveDate: existing.effective_date,
      };
    }

    // 2. Perform chunking based on content type
    const chunks = this.chunkContent(params);
    const sourceId = `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    // 3. Save knowledge source record
    rawDb.prepare(`
      INSERT INTO knowledge_sources (
        id, tenant_id, title, source_type, url, effective_date, checksum, chunk_count, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sourceId,
      ctx.tenantId,
      params.title.trim(),
      params.sourceType,
      params.url || null,
      effectiveDate,
      checksum,
      chunks.length,
      JSON.stringify({ tags: params.tags || [] }),
      now
    );

    // 4. Save individual chunks
    const insertChunk = rawDb.prepare(`
      INSERT INTO knowledge_chunks (id, tenant_id, source_id, content, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const ch of chunks) {
      const chunkId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      insertChunk.run(chunkId, ctx.tenantId, sourceId, ch.content, ch.tags, now);
    }

    return {
      sourceId,
      title: params.title.trim(),
      sourceType: params.sourceType,
      chunkCount: chunks.length,
      checksum,
      isExisting: false,
      effectiveDate,
    };
  }

  /**
   * Chunk content according to content type
   */
  public chunkContent(params: IngestDocumentParams): Array<{ content: string; tags: string }> {
    const defaultTags = (params.tags || []).join(' ');

    if (params.sourceType === 'csv') {
      return this.chunkCsv(params.content, defaultTags);
    }

    // Text, PDF markdown, or URL document
    return this.chunkText(params.content, defaultTags, params.chunkSize || 500, params.chunkOverlap || 50);
  }

  private chunkCsv(content: string, defaultTags: string): Array<{ content: string; tags: string }> {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return [];

    // Parse header
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const chunks: Array<{ content: string; tags: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

      const pairs = headers.map((h, idx) => `${h}: ${values[idx] || '-'}`).join(' | ');
      const rowTags = `${defaultTags} ${values.join(' ')}`.trim();
      chunks.push({
        content: `[ข้อมูลแถวที่ ${i}] ${pairs}`,
        tags: rowTags,
      });
    }

    return chunks;
  }

  private chunkText(content: string, defaultTags: string, chunkSize: number, chunkOverlap: number): Array<{ content: string; tags: string }> {
    const clean = content.trim();
    if (clean.length === 0) return [];

    // If small enough, return as single chunk
    if (clean.length <= chunkSize) {
      return [{ content: clean, tags: defaultTags }];
    }

    // Split by Markdown headers first if available
    const sectionSplit = clean.split(/(?=^#{1,3}\s+)/m);
    if (sectionSplit.length > 1) {
      const chunks: Array<{ content: string; tags: string }> = [];
      for (const section of sectionSplit) {
        const trimmed = section.trim();
        if (!trimmed) continue;
        if (trimmed.length <= chunkSize) {
          chunks.push({ content: trimmed, tags: defaultTags });
        } else {
          chunks.push(...this.slidingWindowChunks(trimmed, defaultTags, chunkSize, chunkOverlap));
        }
      }
      return chunks;
    }

    // Otherwise use sliding window
    return this.slidingWindowChunks(clean, defaultTags, chunkSize, chunkOverlap);
  }

  private slidingWindowChunks(text: string, defaultTags: string, size: number, overlap: number): Array<{ content: string; tags: string }> {
    const chunks: Array<{ content: string; tags: string }> = [];
    let start = 0;

    while (start < text.length) {
      let end = start + size;
      if (end >= text.length) {
        chunks.push({ content: text.slice(start).trim(), tags: defaultTags });
        break;
      }

      // Try to break at a newline or space rather than mid-word
      const lastNewline = text.lastIndexOf('\n', end);
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastNewline > start + size * 0.6) {
        end = lastNewline;
      } else if (lastSpace > start + size * 0.6) {
        end = lastSpace;
      }

      const chunkText = text.slice(start, end).trim();
      if (chunkText) {
        chunks.push({ content: chunkText, tags: defaultTags });
      }

      start = end - overlap;
    }

    return chunks;
  }

  /**
   * List all knowledge sources for the active tenant
   */
  public listSources(): KnowledgeSourceSummary[] {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const rows = rawDb.prepare(`
      SELECT id, tenant_id, title, source_type, url, effective_date, chunk_count, checksum, created_at
      FROM knowledge_sources
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).all(ctx.tenantId) as any[];

    return rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      title: r.title,
      sourceType: r.source_type,
      url: r.url,
      effectiveDate: r.effective_date,
      chunkCount: r.chunk_count || 0,
      checksum: r.checksum,
      createdAt: r.created_at,
    }));
  }

  /**
   * Get source with all its chunks
   */
  public getSource(id: string): { source: KnowledgeSourceSummary; chunks: Array<{ id: string; content: string; tags: string }> } | null {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const source = rawDb.prepare(`
      SELECT * FROM knowledge_sources WHERE id = ? AND tenant_id = ?
    `).get(id, ctx.tenantId) as any;

    if (!source) return null;

    const chunks = rawDb.prepare(`
      SELECT id, content, tags FROM knowledge_chunks WHERE source_id = ? AND tenant_id = ? ORDER BY created_at ASC
    `).all(id, ctx.tenantId) as any[];

    return {
      source: {
        id: source.id,
        tenantId: source.tenant_id,
        title: source.title,
        sourceType: source.source_type,
        url: source.url,
        effectiveDate: source.effective_date,
        chunkCount: source.chunk_count,
        checksum: source.checksum,
        createdAt: source.created_at,
      },
      chunks,
    };
  }

  /**
   * Delete source and its chunks (cascade)
   */
  public deleteSource(id: string): boolean {
    const ctx = getTenantContext();
    const rawDb = this.db.getRawDb();

    const res = rawDb.prepare(`
      DELETE FROM knowledge_sources WHERE id = ? AND tenant_id = ?
    `).run(id, ctx.tenantId);

    return res.changes > 0;
  }
}
