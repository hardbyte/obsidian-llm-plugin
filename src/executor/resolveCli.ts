import fs from "fs";
import os from "os";
import path from "path";

function pathSeparator(): string {
  return process.platform === "win32" ? ";" : ":";
}

function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || os.homedir();
}

/**
 * Directories a Finder-launched macOS app does not inherit from the login shell.
 * Homebrew is one candidate. It is not required: uv, nvm, volta, and a user
 * prefix under ~/.local/bin are checked as well.
 */
export function extraCliDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homeDir(env);
  const dirs: string[] = [];

  if (process.platform === "darwin") {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  } else if (process.platform === "linux") {
    dirs.push("/usr/local/bin");
  }

  if (home) {
    dirs.push(
      path.join(home, ".local", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".volta", "bin"),
    );
    const nvmRoot = path.join(home, ".nvm", "versions", "node");
    if (fs.existsSync(nvmRoot)) {
      const versions = fs
        .readdirSync(nvmRoot)
        .filter((name) => fs.existsSync(path.join(nvmRoot, name, "bin")))
        .sort()
        .reverse();
      for (const version of versions) {
        dirs.push(path.join(nvmRoot, version, "bin"));
      }
    }
  }

  return dirs;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a CLI name to an absolute executable without invoking a shell.
 * A GUI PATH of /usr/bin:/bin misses npx, claude, and gemini installed outside
 * that prefix. The original command is returned when nothing on disk matches,
 * so spawn still reports a missing binary instead of guessing.
 */
export function resolveCli(command: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!command || path.isAbsolute(command)) return command;

  const sep = pathSeparator();
  const pathDirs = (env.PATH || "").split(sep).filter(Boolean);
  const seen = new Set<string>();

  for (const dir of [...pathDirs, ...extraCliDirs(env)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const candidate = path.join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }

  return command;
}

/**
 * PATH for a child so `#!/usr/bin/env node` sees the prefix that held the CLI.
 * Only that directory is added. Other install prefixes stay out of the way.
 */
export function cliEnv(
  env: NodeJS.ProcessEnv = process.env,
  command?: string,
): NodeJS.ProcessEnv {
  if (!command) return env;
  const resolved = resolveCli(command, env);
  if (!path.isAbsolute(resolved)) return env;

  const dir = path.dirname(resolved);
  const sep = pathSeparator();
  const current = env.PATH || "";
  const dirs = current.split(sep).filter(Boolean);
  if (dirs.includes(dir)) return env;
  return {
    ...env,
    PATH: current ? `${dir}${sep}${current}` : dir,
  };
}
