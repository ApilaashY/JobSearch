import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";

const JSON_DIR = "json";
const EMBEDDINGS_DIR = "embeddings";
const OLLAMA_URL = "http://127.0.0.1:11434/api/embeddings";
const OLLAMA_MODEL = "nomic-embed-text";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const CHUNK_SIZE = 2500;
const CHUNK_OVERLAP = 200;
const MIN_CHUNK_SIZE = 250;

export const CONCURRENCY = 2;

type OllamaEmbeddingsResponse = {
  embedding?: number[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function embed(input: string): Promise<number[]> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: input,
        }),
      });

      if (!response.ok) {
        const responseText = await response.text();
        const message = `Ollama embedding request failed: ${response.status} ${response.statusText}${responseText ? ` - ${responseText}` : ""}`;

        if (
          [429, 500, 502, 503, 504].includes(response.status) &&
          attempt < MAX_RETRIES
        ) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }

        throw new Error(message);
      }

      const data = (await response.json()) as OllamaEmbeddingsResponse;

      if (!data.embedding || data.embedding.length === 0) {
        throw new Error("Ollama did not return an embedding vector.");
      }

      return data.embedding;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
    }
  }

  throw new Error(lastError?.message ?? "Unknown embedding failure.");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) {
    return [text];
  }

  const chunks: string[] = [];
  const step = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);

  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) {
      break;
    }
  }

  return chunks;
}

function isContextLengthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  return (
    lower.includes("context length") || lower.includes("input length exceeds")
  );
}

function splitChunk(text: string): [string, string] {
  const middle = Math.floor(text.length / 2);
  return [text.slice(0, middle), text.slice(middle)];
}

async function embedChunkWithFallback(chunk: string): Promise<number[][]> {
  try {
    const vector = await embed(chunk);
    return [vector];
  } catch (error: unknown) {
    if (!isContextLengthError(error) || chunk.length <= MIN_CHUNK_SIZE) {
      throw error;
    }

    const [left, right] = splitChunk(chunk);
    const leftVectors = await embedChunkWithFallback(left);
    const rightVectors = await embedChunkWithFallback(right);
    return [...leftVectors, ...rightVectors];
  }
}

function compactJsonContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed);
  } catch {
    return content;
  }
}

async function embedFile(fileName: string): Promise<boolean> {
  const inputPath = join(JSON_DIR, fileName);
  const baseName = parse(fileName).name;

  const content = await readFile(inputPath, "utf-8");
  const normalizedContent = compactJsonContent(content);
  const chunks = chunkText(normalizedContent);

  let embeddedAnyChunk = false;
  let chunkCounter = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const vectors = await embedChunkWithFallback(chunk);

    for (const vector of vectors) {
      const chunkId = `${baseName}__chunk_${String(chunkCounter).padStart(4, "0")}`;
      const outputPath = join(EMBEDDINGS_DIR, `${chunkId}.json`);

      if (await fileExists(outputPath)) {
        chunkCounter += 1;
        continue;
      }

      await writeFile(
        outputPath,
        JSON.stringify(
          {
            id: chunkId,
            file: fileName,
            model: OLLAMA_MODEL,
            chunkIndex: chunkCounter,
            chunkCount: chunks.length,
            embedding: vector,
          },
          null,
          2,
        ),
        "utf-8",
      );

      embeddedAnyChunk = true;
      chunkCounter += 1;
    }
  }

  return embeddedAnyChunk;
}

type BatchStats = {
  embeddedCount: number;
  failedCount: number;
};

async function processWithConcurrency(
  fileNames: string[],
): Promise<BatchStats> {
  let index = 0;

  async function worker(): Promise<BatchStats> {
    let workerEmbeddedCount = 0;
    let workerFailedCount = 0;

    while (index < fileNames.length) {
      const currentIndex = index;
      index += 1;
      const fileName = fileNames[currentIndex];

      try {
        const didEmbed = await embedFile(fileName);
        if (didEmbed) {
          workerEmbeddedCount += 1;
          console.log(`Embedded ${fileName}`);
        }
      } catch (error: unknown) {
        workerFailedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to embed ${fileName}: ${message}`);
      }
    }

    return {
      embeddedCount: workerEmbeddedCount,
      failedCount: workerFailedCount,
    };
  }

  const workerCount = Math.max(1, Math.min(CONCURRENCY, fileNames.length));
  const results = await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  let embeddedCount = 0;
  let failedCount = 0;

  for (const result of results) {
    embeddedCount += result.embeddedCount;
    failedCount += result.failedCount;
  }

  return {
    embeddedCount,
    failedCount,
  };
}

export async function embedBatch(): Promise<void> {
  await mkdir(EMBEDDINGS_DIR, { recursive: true });

  const entries = await readdir(JSON_DIR, { withFileTypes: true });
  const jsonFiles = entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"),
    )
    .map((entry) => entry.name);

  if (jsonFiles.length === 0) {
    console.log("No JSON files found in json folder.");
    return;
  }

  const { embeddedCount, failedCount } =
    await processWithConcurrency(jsonFiles);
  console.log(
    `Saved ${embeddedCount} new embedding files to ${EMBEDDINGS_DIR}`,
  );

  if (failedCount > 0) {
    console.log(`Skipped ${failedCount} files due to embedding errors`);
  }
}
