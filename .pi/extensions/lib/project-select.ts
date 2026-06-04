import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { RepoMapAskContext, RepoMapInputs } from "./repo-map-draft.ts";

type InputValue = string | undefined;

export const CUSTOM_PROJECT_INPUT_LABEL = "User input";

interface ProjectSelectionOptions {
  cwd?: string;
  repoMapPath?: string;
  localRepoMapPath?: string;
  seed?: Pick<RepoMapInputs, "projectId" | "repoKey">;
  customLabel?: string;
}

interface RegisteredProjectChoice {
  projectId: string;
  repoKey: string;
  label: string;
  description: string;
  localPath: string | null;
  localPathExists: boolean;
  linearProjectId?: string;
  linearProjectName?: string;
  linearProjectPrefix?: string;
  githubOwner?: string;
  githubRepo?: string;
  defaultBranch?: string;
}

function clean(value: InputValue) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolveConfiguredPath(cwd: string, configuredPath: string) {
  return path.resolve(path.isAbsolute(configuredPath) ? configuredPath : path.resolve(cwd, configuredPath));
}

function repoMapPaths(options: Pick<ProjectSelectionOptions, "cwd" | "repoMapPath" | "localRepoMapPath"> = {}) {
  const cwd = options.cwd || process.cwd();
  return {
    repoMapPath: resolveConfiguredPath(cwd, options.repoMapPath || process.env.REPO_MAP_PATH || "config/repo-map.yaml"),
    localRepoMapPath: resolveConfiguredPath(cwd, options.localRepoMapPath || process.env.REPO_MAP_LOCAL_PATH || "state/repo-map.local.yaml")
  };
}

function repoKeyOf(entry: any) {
  return clean(entry?.repoKey) || clean(entry?.key);
}

function readYamlRepos(file: string) {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = YAML.parse(fs.readFileSync(file, "utf8")) || {};
    return Array.isArray(parsed.repos) ? parsed.repos : [];
  } catch {
    return [];
  }
}

function readRepoMapEntries(options: Pick<ProjectSelectionOptions, "cwd" | "repoMapPath" | "localRepoMapPath"> = {}) {
  const paths = repoMapPaths(options);
  const merged: any[] = [];
  const byKey = new Map<string, number>();
  for (const entry of readYamlRepos(paths.repoMapPath)) {
    const key = repoKeyOf(entry);
    if (key) byKey.set(key, merged.length);
    merged.push(entry);
  }
  for (const entry of readYamlRepos(paths.localRepoMapPath)) {
    const key = repoKeyOf(entry);
    if (key && byKey.has(key)) merged[byKey.get(key)!] = entry;
    else {
      if (key) byKey.set(key, merged.length);
      merged.push(entry);
    }
  }
  return merged;
}

function repoMapSourceLabel(options: Pick<ProjectSelectionOptions, "repoMapPath" | "localRepoMapPath"> = {}) {
  const base = options.repoMapPath || process.env.REPO_MAP_PATH || "config/repo-map.yaml";
  const local = options.localRepoMapPath || process.env.REPO_MAP_LOCAL_PATH || "state/repo-map.local.yaml";
  return `${base} + ${local}`;
}

export function listRegisteredProjectChoices(options: Pick<ProjectSelectionOptions, "cwd" | "repoMapPath" | "localRepoMapPath"> = {}): RegisteredProjectChoice[] {
  const cwd = options.cwd || process.cwd();
  return readRepoMapEntries(options)
    .map((entry: any): RegisteredProjectChoice | null => {
      const projectId = repoKeyOf(entry);
      if (!projectId) return null;
      const configuredLocalPath = clean(entry?.localPath) || clean(entry?.local?.path) || clean(entry?.local?.root);
      if (!configuredLocalPath) return null;
      const localPath = configuredLocalPath ? resolveConfiguredPath(cwd, configuredLocalPath) : null;
      const linearProjectId = clean(entry?.linear?.projectId) || clean(entry?.linearProjectId);
      const linearProjectName = clean(entry?.linear?.projectName) || clean(entry?.linearProjectName);
      const linearProjectPrefix = clean(entry?.linear?.projectPrefix) || clean(entry?.linearProjectPrefix);
      const githubOwner = clean(entry?.github?.owner) || clean(entry?.owner) || clean(entry?.githubOwner);
      const githubRepo = clean(entry?.github?.repo) || clean(entry?.repo) || clean(entry?.githubRepo);
      const defaultBranch = clean(entry?.github?.defaultBranch) || clean(entry?.defaultBranch);
      const linearLabel = linearProjectId || linearProjectName || linearProjectPrefix || "unmapped Linear Project";
      const localLabel = localPath || "missing localPath";
      return {
        projectId,
        repoKey: projectId,
        label: projectId,
        description: `${localLabel}; Linear ${linearLabel}`,
        localPath,
        localPathExists: Boolean(localPath && fs.existsSync(localPath)),
        linearProjectId,
        linearProjectName,
        linearProjectPrefix,
        githubOwner,
        githubRepo,
        defaultBranch
      };
    })
    .filter((choice: RegisteredProjectChoice | null): choice is RegisteredProjectChoice => Boolean(choice));
}

function customProjectOption(label = CUSTOM_PROJECT_INPUT_LABEL) {
  return {
    projectId: label,
    label,
    description: "Type a project ID manually.",
    custom: true
  };
}

function projectSelectionOptions(options: ProjectSelectionOptions = {}) {
  return [...listRegisteredProjectChoices(options), customProjectOption(options.customLabel)];
}

function projectSelectionResult(choice: RegisteredProjectChoice) {
  const linearProjectIdOrKey = choice.linearProjectId || choice.linearProjectName || choice.linearProjectPrefix || choice.projectId;
  return {
    ok: true,
    status: "project_selected" as const,
    source: "repo_map" as const,
    selectedProjectId: choice.projectId,
    repoKey: choice.repoKey,
    localPath: choice.localPath,
    localPathExists: choice.localPathExists,
    linearProjectIdOrKey,
    linear: {
      projectId: choice.linearProjectId,
      projectName: choice.linearProjectName,
      projectPrefix: choice.linearProjectPrefix
    },
    github: {
      owner: choice.githubOwner,
      repo: choice.githubRepo,
      defaultBranch: choice.defaultBranch
    },
    writesPerformed: false,
    confirmationRequired: false,
    evidenceGaps: [] as string[],
    openQuestions: [] as string[],
    nextActions: [
      `Build the Fact Pack with repoKey=${choice.repoKey}; only after this selection should Linear project context be read.`
    ]
  };
}

function customProjectSelectionResult(projectId: string, options: Pick<ProjectSelectionOptions, "repoMapPath" | "localRepoMapPath"> = {}) {
  const source = repoMapSourceLabel(options);
  return {
    ok: true,
    status: "custom_project_input" as const,
    source: "user_input" as const,
    selectedProjectId: projectId,
    repoKey: projectId,
    localPath: null,
    localPathExists: false,
    linearProjectIdOrKey: projectId,
    writesPerformed: false,
    confirmationRequired: false,
    evidenceGaps: [
      `Custom project ID is not confirmed against ${source}: ${projectId}`
    ],
    openQuestions: [
      "Register this project in the local three-source repo-map if it should become a durable project directory mapping."
    ],
    nextActions: [
      "After this explicit user selection, read Linear only for the selected project ID/key."
    ]
  };
}

export function createNonInteractiveProjectSelectionResult(options: ProjectSelectionOptions = {}) {
  const optionsForUser = projectSelectionOptions(options);
  const source = repoMapSourceLabel(options);
  return {
    ok: false,
    status: "needs_project_selection" as const,
    writesPerformed: false,
    projectOptions: optionsForUser,
    evidenceGaps: [
      `Pi UI is not available; choose one local project ID from ${source} before reading Linear project context.`
    ],
    openQuestions: [
      "Choose one local project ID from the repo-map options, or provide custom input."
    ]
  };
}

function selectionTitle(options: ProjectSelectionOptions = {}) {
  const source = repoMapSourceLabel(options);
  return `Choose local project ID from ${source} before Linear read`;
}

export async function runProjectSelectionFlow(ctx: RepoMapAskContext, options: ProjectSelectionOptions = {}) {
  const choices = listRegisteredProjectChoices(options);
  const seededProjectId = clean(options.seed?.projectId) || clean(options.seed?.repoKey);
  if (seededProjectId) {
    const seededChoice = choices.find(choice => choice.projectId === seededProjectId);
    return seededChoice ? projectSelectionResult(seededChoice) : customProjectSelectionResult(seededProjectId, options);
  }

  if (!ctx.hasUI) return createNonInteractiveProjectSelectionResult(options);

  const customLabel = options.customLabel || CUSTOM_PROJECT_INPUT_LABEL;
  const labels = [...choices.map(choice => choice.label), customLabel];
  const selected = clean(typeof ctx.ui.select === "function"
    ? await ctx.ui.select(selectionTitle(options), labels)
    : await ctx.ui.input(selectionTitle(options), labels.join(" | ")));
  if (!selected) {
    return {
      ok: false,
      status: "cancelled" as const,
      writesPerformed: false,
      projectOptions: projectSelectionOptions(options),
      evidenceGaps: ["Project selection was cancelled before Linear project context was read."],
      openQuestions: ["Choose a project ID before running single-project Fact Pack or Linear reads."]
    };
  }

  if (selected === customLabel) {
    const custom = clean(await ctx.ui.input("Project ID", "Local repo-map project ID, Linear Project ID/name, or URL"));
    if (!custom) {
      return {
        ok: false,
        status: "cancelled" as const,
        writesPerformed: false,
        projectOptions: projectSelectionOptions(options),
        evidenceGaps: ["Custom project input was cancelled before Linear project context was read."],
        openQuestions: ["Provide a custom project ID, or choose one local repo-map project ID."]
      };
    }
    return customProjectSelectionResult(custom, options);
  }

  const choice = choices.find(choice => choice.label === selected || choice.projectId === selected);
  return choice ? projectSelectionResult(choice) : customProjectSelectionResult(selected, options);
}
