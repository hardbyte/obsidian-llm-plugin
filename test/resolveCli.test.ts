import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cliEnv,
  needsWindowsShell,
  resolveCli,
} from "../src/executor/resolveCli.ts";

const GUI_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

function fixtureHome(): { home: string; npx: string } {
  const home = mkdtempSync(join(tmpdir(), "obsidian-llm-home-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  const npx = join(bin, "npx");
  writeFileSync(npx, "#!/bin/sh\necho npx-ok\n");
  chmodSync(npx, 0o755);
  return { home, npx };
}

test("GUI PATH cannot see npx, ~/.local/bin can", () => {
  const { home, npx } = fixtureHome();
  try {
    const env = { PATH: GUI_PATH, HOME: home };
    const red = spawnSync("npx", ["-v"], {
      shell: true,
      env,
      encoding: "utf8",
    });
    assert.notEqual(red.status, 0, "bare npx on the Finder PATH should fail");
    const blob = `${red.stderr || ""}${red.stdout || ""}${red.error?.message || ""}`;
    assert.match(blob, /not found|ENOENT/i);

    const resolved = resolveCli("npx", env);
    assert.equal(resolved, npx);
    const green = spawnSync(resolved, ["-v"], {
      shell: false,
      env: cliEnv(env, "npx"),
      encoding: "utf8",
    });
    assert.equal(green.status, 0, green.stderr);
    assert.match(green.stdout, /npx-ok/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a missing Homebrew prefix does not throw", () => {
  const home = mkdtempSync(join(tmpdir(), "obsidian-llm-empty-"));
  try {
    const env = { PATH: GUI_PATH, HOME: home };
    assert.equal(resolveCli("npx", env), "npx");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Windows GUI PATH misses npm global; APPDATA\\npm finds codex.cmd", () => {
  const home = mkdtempSync(join(tmpdir(), "obsidian-llm-win-"));
  const appData = join(home, "AppData", "Roaming");
  const npm = join(appData, "npm");
  mkdirSync(npm, { recursive: true });
  const extensionless = join(npm, "codex");
  const shim = join(npm, "codex.cmd");
  writeFileSync(extensionless, "#!/bin/sh\necho bare\n");
  writeFileSync(shim, "@echo off\r\necho codex-ok\r\n");

  try {
    const env = {
      PATH: "C:\\Windows\\System32",
      USERPROFILE: home,
      HOME: home,
      APPDATA: appData,
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    };
    // PATHEXT uses .CMD; Windows paths are case-insensitive.
    assert.equal(resolveCli("codex", env, "win32").toLowerCase(), shim.toLowerCase());
    assert.equal(needsWindowsShell(shim, "win32"), true);
    assert.equal(needsWindowsShell(resolveCli("codex", env, "win32"), "win32"), true);
    assert.ok(
      (cliEnv(env, "codex", "win32").PATH || "").includes(npm),
      "child PATH should prepend the npm global prefix",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("absolute Windows .cmd custom command needs a shell", () => {
  const cmd = "C:\\Users\\lubo\\AppData\\Roaming\\npm\\codex.cmd";
  assert.equal(needsWindowsShell(cmd, "win32"), true);
  assert.equal(needsWindowsShell(cmd, "darwin"), false);
  assert.equal(needsWindowsShell("/opt/homebrew/bin/npx", "darwin"), false);
  assert.equal(needsWindowsShell("C:\\Program Files\\nodejs\\node.exe", "win32"), false);
});
