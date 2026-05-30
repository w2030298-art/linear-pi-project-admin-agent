import type { ExtensionAPI, ExecResult } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

type RuntimeGitAction = "inside" | "branch" | "status" | "stash-generated-state" | "fetch" | "pull";

type RuntimePreflightInput = {
  insideWorkTree: boolean;
  branch: string;
  dirtyStatus: string;
};

type RuntimePreflightResult =
  | { ok: true }
  | { ok: false; reason: string };

type DependencyInstallState = {
  hasPackageJson: boolean;
  hasPackageLock?: boolean;
  hasNodeModules: boolean;
  hasStamp: boolean;
  packageJsonMtimeMs?: number;
  packageLockMtimeMs?: number;
  stampMtimeMs?: number;
};

const GIT_TIMEOUT_MS = 120000;
const NPM_TIMEOUT_MS = 300000;
const STABLE_BRANCH = "master";
const DEPENDENCY_STAMP = ".linear-pi-runtime-deps.stamp";
const ALLOWED_RUNTIME_DIRTY_PATTERNS = [
  /^state\/portfolio-review\/[^/]+\.json$/,
  /^state\/fact-packs\/[^/]+\.json$/,
  /^state\/fact-packs\/evidence\/.+$/,
  /^state\/write-plans\/.+$/,
  /^state\/audit-reports\/.+$/,
  /^state\/[^/]+\.jsonl$/,
  /^state\/repo-map\.draft\.yaml$/,
  /^state\/repo-map-audit\.jsonl$/,
  /^\.pi\/sessions\/.+$/
];

export function runtimeGitArgs(cwd: string, action: RuntimeGitAction): string[] {
  if (action === "inside") return ["-C", cwd, "rev-parse", "--is-inside-work-tree"];
  if (action === "branch") return ["-C", cwd, "branch", "--show-current"];
  if (action === "status") return ["-C", cwd, "status", "--porcelain"];
  if (action === "stash-generated-state") {
    return ["-C", cwd, "stash", "push", "--include-untracked", "-m", "linear-pi-runtime-generated-state-before-reload"];
  }
  if (action === "fetch") return ["-C", cwd, "fetch", "origin", STABLE_BRANCH];
  return ["-C", cwd, "pull", "--ff-only", "origin", STABLE_BRANCH];
}

export function runtimeNpmArgs(hasPackageLock: boolean): string[] {
  return [hasPackageLock ? "ci" : "install"];
}

function dirtyPath(line: string): string | null {
  if (line.length < 4) return null;
  if (line.includes(" -> ")) return null;
  return line.slice(3).trim().replace(/\\/g, "/");
}

export function isAllowedRuntimeDirtyStatus(dirtyStatus: string): boolean {
  const lines = dirtyStatus.split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean);
  if (!lines.length) return true;
  return lines.every(line => {
    const changedPath = dirtyPath(line);
    return Boolean(changedPath && ALLOWED_RUNTIME_DIRTY_PATTERNS.some(pattern => pattern.test(changedPath)));
  });
}

export function reloadMasterPreflight(input: RuntimePreflightInput): RuntimePreflightResult {
  const branch = input.branch.trim();
  const dirtyStatus = input.dirtyStatus;

  if (!input.insideWorkTree) {
    return { ok: false, reason: "Current directory is not a git worktree." };
  }

  if (branch !== STABLE_BRANCH) {
    return {
      ok: false,
      reason: `Current branch is ${branch || "(unknown)"}, not ${STABLE_BRANCH}; /reload-master only runs in the stable runtime checkout.`
    };
  }

  if (dirtyStatus.trim() && !isAllowedRuntimeDirtyStatus(dirtyStatus)) {
    return {
      ok: false,
      reason: "Runtime checkout is dirty; commit, stash, or discard local changes before pulling origin/master."
    };
  }

  return { ok: true };
}

export function shouldInstallDependencies(state: DependencyInstallState): boolean {
  if (!state.hasPackageJson) return false;
  if (!state.hasNodeModules || !state.hasStamp) return true;
  const stampMtimeMs = state.stampMtimeMs ?? 0;
  if ((state.packageJsonMtimeMs ?? 0) > stampMtimeMs) return true;
  return Boolean(state.hasPackageLock && (state.packageLockMtimeMs ?? 0) > stampMtimeMs);
}

function output(result: ExecResult): string {
  return (result.stdout || result.stderr || "").trim();
}

async function git(pi: ExtensionAPI, cwd: string, action: RuntimeGitAction): Promise<ExecResult> {
  return pi.exec("git", runtimeGitArgs(cwd, action), { timeout: GIT_TIMEOUT_MS });
}

async function gitOutput(pi: ExtensionAPI, cwd: string, action: RuntimeGitAction): Promise<string> {
  const result = await git(pi, cwd, action);
  if (result.code !== 0) {
    throw new Error(`git ${action} failed: ${output(result) || `exit code ${result.code}`}`);
  }
  return output(result);
}

function mtimeMs(filePath: string): number | undefined {
  return fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : undefined;
}

function readDependencyInstallState(cwd: string): DependencyInstallState {
  const packageJsonPath = path.join(cwd, "package.json");
  const packageLockPath = path.join(cwd, "package-lock.json");
  const nodeModulesPath = path.join(cwd, "node_modules");
  const stampPath = path.join(nodeModulesPath, DEPENDENCY_STAMP);

  return {
    hasPackageJson: fs.existsSync(packageJsonPath),
    hasPackageLock: fs.existsSync(packageLockPath),
    hasNodeModules: fs.existsSync(nodeModulesPath),
    hasStamp: fs.existsSync(stampPath),
    packageJsonMtimeMs: mtimeMs(packageJsonPath),
    packageLockMtimeMs: mtimeMs(packageLockPath),
    stampMtimeMs: mtimeMs(stampPath)
  };
}

async function ensureNodeDependencies(pi: ExtensionAPI, cwd: string, notify: (message: string) => void): Promise<void> {
  const state = readDependencyInstallState(cwd);
  if (!shouldInstallDependencies(state)) return;

  notify("Installing runtime dependencies before reload...");
  const result = await pi.exec("npm", runtimeNpmArgs(Boolean(state.hasPackageLock)), { cwd, timeout: NPM_TIMEOUT_MS });
  if (result.code !== 0) {
    throw new Error(`npm install failed: ${output(result) || `exit code ${result.code}`}`);
  }

  const nodeModulesPath = path.join(cwd, "node_modules");
  fs.mkdirSync(nodeModulesPath, { recursive: true });
  fs.writeFileSync(path.join(nodeModulesPath, DEPENDENCY_STAMP), "");
}

export default function runtimeMasterReload(pi: ExtensionAPI) {
  pi.registerCommand("reload-master", {
    description: "Pull latest origin/master with --ff-only, then reload Pi runtime.",
    handler: async (_args, ctx) => {
      const inside = await git(pi, ctx.cwd, "inside");
      const insideWorkTree = inside.code === 0 && output(inside) === "true";
      const branch = insideWorkTree ? await gitOutput(pi, ctx.cwd, "branch") : "";
      const dirtyStatus = insideWorkTree ? await gitOutput(pi, ctx.cwd, "status") : "";
      const preflight = reloadMasterPreflight({ insideWorkTree, branch, dirtyStatus });

      if (!preflight.ok) {
        if (ctx.hasUI) ctx.ui.notify(preflight.reason, "error");
        throw new Error(`/reload-master blocked: ${preflight.reason}`);
      }

      if (dirtyStatus.trim()) {
        if (ctx.hasUI) ctx.ui.notify("Stashing generated runtime state before pulling origin/master...", "info");
        await gitOutput(pi, ctx.cwd, "stash-generated-state");
      }
      if (ctx.hasUI) ctx.ui.notify("Pulling latest origin/master before reload...", "info");
      await gitOutput(pi, ctx.cwd, "fetch");
      await gitOutput(pi, ctx.cwd, "pull");
      await ensureNodeDependencies(pi, ctx.cwd, (message) => {
        if (ctx.hasUI) ctx.ui.notify(message, "info");
      });
      await ctx.reload();
    }
  });
}
