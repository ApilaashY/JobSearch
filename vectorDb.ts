import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";

const EMBEDDINGS_DIR = "embeddings";
const DB_DIR = "db";
const DB_PATH = join(DB_DIR, "vectors.json");

type StoredEmbeddingFile = {
  file: string;
  model: string;
  embedding: number[];
};

export type VectorRecord = {
  id: string;
  file: string;
  model: string;
  embedding: number[];
};

export type SearchResult = {
  id: string;
  file: string;
  model: string;
  score: number;
};

export type FileSearchResult = {
  file: string;
  score: number;
  bestChunkId: string;
};

async function readDb(): Promise<VectorRecord[]> {
  try {
    const raw = await readFile(DB_PATH, "utf-8");
    const parsed = JSON.parse(raw) as VectorRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeDb(records: VectorRecord[]): Promise<void> {
  await mkdir(DB_DIR, { recursive: true });
  await writeFile(DB_PATH, JSON.stringify(records, null, 2), "utf-8");
}

export async function upsertEmbeddingsFromFolder(): Promise<number> {
  await mkdir(EMBEDDINGS_DIR, { recursive: true });

  const entries = await readdir(EMBEDDINGS_DIR, { withFileTypes: true });
  const embeddingFiles = entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"),
    )
    .map((entry) => entry.name);

  const existing = await readDb();
  const byId = new Map<string, VectorRecord>(
    existing.map((record) => [record.id, record]),
  );

  for (const fileName of embeddingFiles) {
    const fullPath = join(EMBEDDINGS_DIR, fileName);
    const raw = await readFile(fullPath, "utf-8");
    const parsed = JSON.parse(raw) as StoredEmbeddingFile;

    if (!Array.isArray(parsed.embedding) || parsed.embedding.length === 0) {
      continue;
    }

    const id = parse(fileName).name;
    byId.set(id, {
      id,
      file: parsed.file,
      model: parsed.model,
      embedding: parsed.embedding,
    });
  }

  const next = Array.from(byId.values());
  await writeDb(next);
  return next.length;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return -1;
  }

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }

  if (aNorm === 0 || bNorm === 0) {
    return -1;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export async function semanticSearch(
  queryEmbedding: number[],
  limit = 20,
): Promise<SearchResult[]> {
  const records = await readDb();

  return records
    .map((record) => ({
      id: record.id,
      file: record.file,
      model: record.model,
      score: cosineSimilarity(queryEmbedding, record.embedding),
    }))
    .filter((result) => result.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

export async function semanticSearchByFile(
  queryEmbedding: number[],
  limit = 20,
): Promise<FileSearchResult[]> {
  const chunkResults = await semanticSearch(
    queryEmbedding,
    Number.MAX_SAFE_INTEGER,
  );
  const bestByFile = new Map<string, FileSearchResult>();

  for (const result of chunkResults) {
    const existing = bestByFile.get(result.file);
    if (!existing || result.score > existing.score) {
      bestByFile.set(result.file, {
        file: result.file,
        score: result.score,
        bestChunkId: result.id,
      });
    }
  }

  return Array.from(bestByFile.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}
