import fs from "fs";
import os from "os";
import path from "path";

function pathSeparator(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? ";" : ":";
}

function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || os.homedir();
}

/**
 * Directories a GUI-launched Obsidian does not inherit from an interactive shell.
 * macOS Finder keeps PATH at /usr/bin:/bin. Windows apps often miss the npm
 * global prefix under %APPDATA%\\npm where codex.cmd lives.
 */
export function extraCliDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const home = homeDir(env);
  const dirs: string[] = [];

  if (platform === "darwin") {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  } else if (platform === "linux") {
    dirs.push("/usr/local/bin");
  } else if (platform === "win32") {
    const appData =
      env.APPDATA || (home ? path.join(home, "AppData", "Roaming") : "");
    const localAppData =
      env.LOCALAPPDATA || (home ? path.join(home, "AppData", "Local") : "");
    if (appData) dirs.push(path.join(appData, "npm"));
    if (localAppData) dirs.push(path.join(localAppData, "npm"));
    if (env.NVM_HOME) dirs.push(env.NVM_HOME);
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

function isPresentFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isExecutable(filePath: string, platform: NodeJS.Platform): boolean {
  if (!isPresentFile(filePath)) return false;
  if (platform === "win32") {
    // Windows has no POSIX X_OK. Candidate names are already filtered by PATHEXT.
    return true;
  }
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * On Windows, npm installs both an extensionless shim and `name.cmd`. Prefer
 * PATHEXT matches so spawn can target the .cmd the shell would run.
 */
function candidateFileNames(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== "win32") return [command];
  if (path.extname(command)) return [command];

  const pathext = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));

  return [...pathext.map((ext) => command + ext), command];
}

/**
 * Node's spawn with shell:false cannot launch Windows .cmd/.bat shims (EINVAL).
 * Keep shell:false everywhere else, including absolute PE binaries and POSIX paths.
 */
export function needsWindowsShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32" || !command) return false;
  return /\.(cmd|bat)$/i.test(command);
}

/**
 * Resolve a CLI name to an absolute executable without invoking a shell.
 * A GUI PATH misses npx/claude/gemini/codex installed outside that prefix.
 * The original command is returned when nothing on disk matches, so spawn
 * still reports a missing binary instead of guessing.
 */
export function resolveCli(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!command || path.isAbsolute(command)) return command;

  const sep = pathSeparator(platform);
  const pathDirs = (env.PATH || "").split(sep).filter(Boolean);
  const seen = new Set<string>();
  const names = candidateFileNames(command, env, platform);

  for (const dir of [...pathDirs, ...extraCliDirs(env, platform)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate, platform)) return candidate;
    }
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
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (!command) return env;
  const resolved = resolveCli(command, env, platform);
  if (!path.isAbsolute(resolved)) return env;

  const dir = path.dirname(resolved);
  const sep = pathSeparator(platform);
  const current = env.PATH || "";
  const dirs = current.split(sep).filter(Boolean);
  if (dirs.includes(dir)) return env;
  return {
    ...env,
    PATH: current ? `${dir}${sep}${current}` : dir,
  };
}
