import argparse
import json
from pathlib import Path

from jobspy import scrape_jobs

JOB_COUNT = 100

parser = argparse.ArgumentParser()
parser.add_argument("-n", "--name", default="Software Engineer")
args = parser.parse_args()

jobs = scrape_jobs(
    site_name=["indeed", "linkedin", "zip_recruiter", "google"],
    search_term=args.name,
    results_wanted=JOB_COUNT,
    country_indeed="USA",
)

output_dir = Path("json")
output_dir.mkdir(exist_ok=True)

for index, row in jobs.iterrows():
    row_data = {
        key: (None if value != value else value)
        for key, value in row.items()
    }
    file_name = row_data.get("id") or f"job-{index}"
    file_path = output_dir / f"{file_name}.json"

    with file_path.open("w", encoding="utf-8") as json_file:
        json.dump(row_data, json_file, indent=2, default=str)
