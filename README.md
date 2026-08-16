# Job Scraper + Local Semantic Search

This project scrapes jobs with Python, embeds the job JSON data with Ollama, stores vectors in a local JSON database, and returns top semantic matches.

## What this project does

1. Ensures a Python virtual environment exists.
2. Installs Python dependencies from requirements.txt when creating the venv.
3. Scrapes jobs using jobspy.
4. Saves each scraped job as its own JSON file in the json folder.
5. Embeds JSON files using Ollama embeddings.
6. Stores embeddings in the embeddings folder.
7. Upserts vectors into a local DB file at db/vectors.json.
8. Runs semantic search and prints top results with useful job details.

## Project files

- main.ts: Orchestrates scrape, embed, index, and semantic search.
- scrape.py: Scrapes jobs and writes JSON files.
- embed.ts: Creates embeddings with chunking, retries, and context-length fallback splitting.
- vectorDb.ts: Local vector store and cosine similarity search.
- manageEnv.ts: Python venv detection and creation.

## Prerequisites

1. Node.js 18+ (Node 20+ recommended).
2. Python 3.10+.
3. Ollama running locally.
4. Ollama embedding model pulled (current model in embed.ts is nomic-embed-text).

Commands:

- npm install
- ollama pull nomic-embed-text
- ollama serve

## Install and run

Main command:

- npm run main -- -n "Job Title"

Examples:

- npm run main -- -n "Software Engineer"
- npm run main -- -n "Data Engineer" -c 10

CLI args:

- -n is required: Search phrase used for scraping and semantic query embedding.
- -c is optional: Number of semantic results to print. Default is 20.

## Output folders

- json: One JSON file per scraped job.
- embeddings: One or more embedding files per source job file (chunked when needed).
- db: Local vector database file at db/vectors.json.

## Notes

- scrape.py currently uses a fixed scrape count via JOB_COUNT.
- If Ollama returns context-length errors, embed.ts automatically splits chunks and retries.
- Existing embedding chunk files are skipped, so re-runs are incremental.

## Troubleshooting

If you see missing model errors:

- ollama pull nomic-embed-text

If you see Ollama connection errors:

- Start Ollama with ollama serve
- Confirm Ollama endpoint in embed.ts is http://127.0.0.1:11434/api/embeddings

If Python dependencies are missing:

- Delete venv and rerun main, or run:
- venv/bin/python -m pip install -r requirements.txt
