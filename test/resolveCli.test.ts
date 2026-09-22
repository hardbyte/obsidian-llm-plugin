import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cliEnv, resolveCli } from "../src/executor/resolveCli.ts";

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
