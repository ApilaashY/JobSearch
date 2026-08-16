import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const PLATFORM = process.platform;
const VENV_DIR = "venv";

export function getPythonPath(): string {
  if (PLATFORM === "win32") {
    return join(VENV_DIR, "Scripts", "python.exe");
  }

  return join(VENV_DIR, "bin", "python");
}

export function createVenv(): void {
  const commands = PLATFORM === "win32" ? ["python"] : ["python3", "python"];

  for (const command of commands) {
    const result = spawnSync(command, ["-m", "venv", VENV_DIR], {
      stdio: "inherit",
    });
    if (result.status === 0) {
      installRequirements();
      return;
    }
  }

  throw new Error(
    "Unable to create venv. Make sure Python is installed and available in PATH.",
  );
}

export function installRequirements(): void {
  if (!existsSync("requirements.txt")) {
    throw new Error("requirements.txt not found in project root.");
  }

  const result = spawnSync(
    getPythonPath(),
    ["-m", "pip", "install", "-r", "requirements.txt"],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error("Failed to install packages from requirements.txt.");
  }
}

export function venvExists(): boolean {
  if (existsSync(getPythonPath())) {
    return true;
  }

  // Optional fallback for non-standard Windows venv layouts.
  return PLATFORM === "win32" && existsSync(join(VENV_DIR, "Source", "python"));
}
