import { createVenv, venvExists } from "./manageEnv";
import { execSync } from "child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { embed, embedBatch } from "./embed";
import { semanticSearchByFile, upsertEmbeddingsFromFolder } from "./vectorDb";

function getNameArg(): string {
  const args = process.argv.slice(2);
  const nameIndex = args.indexOf("-n");

  if (nameIndex === -1) {
    throw new Error(
      'Missing required -n argument. Usage: npm run main -- -n "Job Title"',
    );
  }

  const nameValue = args[nameIndex + 1];
  if (!nameValue || nameValue.startsWith("-")) {
    throw new Error(
      'Missing value for -n. Usage: npm run main -- -n "Job Title"',
    );
  }

  return nameValue;
}

function getCountArg(): number {
  const args = process.argv.slice(2);
  const countIndex = args.indexOf("-c");

  if (countIndex === -1) {
    return 20;
  }

  const countValue = args[countIndex + 1];
  if (!countValue || countValue.startsWith("-")) {
    throw new Error(
      'Missing value for -c. Usage: npm run main -- -n "Job Title" -c 20',
    );
  }

  const parsed = Number.parseInt(countValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(
      "Invalid -c value. It must be a positive integer, e.g. -c 20",
    );
  }

  return parsed;
}

type JobDetails = {
  title?: string;
  company?: string;
  location?: string;
  date_posted?: string;
  job_url?: string;
  site?: string;
};

async function readJobDetails(fileName: string): Promise<JobDetails | null> {
  try {
    const filePath = join("json", fileName);
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as JobDetails;
  } catch {
    return null;
  }
}

function textOrNA(value?: string): string {
  return value && value.trim().length > 0 ? value.trim() : "N/A";
}

async function main() {
  let searchName: string;
  let resultCount: number;
  try {
    searchName = getNameArg();
    resultCount = getCountArg();
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }

  if (!venvExists()) {
    // Create the virtual environment if it doesn't exist
    console.log("Creating virtual environment...");
    createVenv();
  }

  // Check if the virtual enviornment exists
  try {
    const stdout = execSync(`venv/bin/python scrape.py -n "${searchName}"`, {
      encoding: "utf-8",
    });
    console.log(`Python stdout: ${stdout.trim()}`);
  } catch (error: any) {
    console.error(`Execution error: ${error.message}`);
    if (error.stderr) {
      console.error(`Python stderr: ${error.stderr}`);
    }
  }

  // Now embed all of the json data
  await embedBatch();

  // Embedding search
  const totalIndexed = await upsertEmbeddingsFromFolder();
  console.log(`Indexed ${totalIndexed} embeddings in local DB`);

  const searchEmbedding = await embed(searchName);
  const results = await semanticSearchByFile(searchEmbedding, resultCount);

  console.log(`Top semantic results for: ${searchName}`);
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const details = await readJobDetails(result.file);

    if (!details) {
      console.log(
        `${i + 1}. score=${result.score.toFixed(4)} | file=${result.file} | details unavailable`,
      );
      continue;
    }

    console.log(
      `${i + 1}. ${textOrNA(details.title)} (${result.score.toFixed(4)})`,
    );
    console.log(`   company: ${textOrNA(details.company)}`);
    console.log(`   location: ${textOrNA(details.location)}`);
    console.log(`   source: ${textOrNA(details.site)}`);
    console.log(`   posted: ${textOrNA(details.date_posted)}`);
    console.log(`   url: ${textOrNA(details.job_url)}`);
    console.log(`   file: ${result.file}`);
    console.log(`   best chunk: ${result.bestChunkId}`);
  }
}

main();
