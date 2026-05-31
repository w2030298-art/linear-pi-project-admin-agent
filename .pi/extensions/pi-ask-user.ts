import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import YAML from "yaml";
import {
  buildWriteConfirmationMessage,
  buildWriteConfirmationText,
  registerWriteConfirmationArtifact,
  toApprovalArtifactResponse,
  WRITE_CONFIRMATION_UI_TITLE
} from "../../scripts/write-confirmation-artifact.ts";

type InputValue = string | undefined;

export const CUSTOM_PROJECT_INPUT_LABEL = "User input";

export interface RepoMapInputs {
  projectId?: string;
  linearProjectId?: string;
  githubUrl?: string;
  linearProject?: string;
  localRepoPath?: string;
  repoKey?: string;
  defaultBranch?: string;
}

interface LinearResolution {
  ok: boolean;
  error?: string;
  project?: unknown;
}

interface LinearProjectSummary {
  id?: string;
  name?: string;
  url?: string;
}

interface FlowOptions {
  cwd?: string;
  repoMapPath?: string;
  localRepoMapPath?: string;
  seed?: RepoMapInputs;
  maxRetries?: number;
  linearProjectResolved?: boolean;
  resolveLinearProject?: (project: string) => Promise<LinearResolution>;
}

interface ProjectSelectionOptions {
  cwd?: string;
  repoMapPath?: string;
  localRepoMapPath?: string;
  seed?: Pick<RepoMapInputs, "projectId" | "repoKey">;
  customLabel?: string;
}

interface RepoMapAskContext {
  hasUI: boolean;
  ui: {
    input(title: string, placeholder?: string): Promise<InputValue>;
    select?(title: string, options: string[]): Promise<InputValue>;
    confirm?(title: string, message: string): Promise<boolean>;
    notify?(message: string, type?: "info" | "warning" | "error"): void;
  };
}

export interface WriteConfirmationInputs {
  writePlanPath: string;
  idempotencyKey: string;
  targetProjectSummary?: string;
  operationsSummary?: string;
  risksSummary?: string;
  nonChangesSummary?: string;
  planDigest?: string;
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

type AskFieldResult =
  | { ok: true; value: string }
  | { ok: false; reason: "cancelled"; fieldTitle: string }
  | { ok: false; reason: "invalid"; inputs: RepoMapInputs; evidenceGaps: string[] };

const FIELD_ORDER: Array<{
  key: keyof RepoMapInputs;
  title: string;
  placeholder: string;
}> = [
  { key: "linearProject", title: "Linear Project", placeholder: "Project ID, name, slug, or URL" },
  { key: "githubUrl", title: "GitHub URL", placeholder: "https://github.com/owner/repo" },
  { key: "localRepoPath", title: "Local repo path", placeholder: "C:/path/to/repo" },
  { key: "repoKey", title: "Repo key", placeholder: "linear-bridge" },
  { key: "defaultBranch", title: "Default branch", placeholder: "main" }
];

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

function clean(value: InputValue) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function cleanLocalRepoPath(value: InputValue) {
  const trimmed = clean(value);
  if (!trimmed) return undefined;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    return clean(trimmed.slice(1, -1));
  }
  return trimmed;
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

function projectSummary(project: unknown): { id?: string; name?: string; url?: string } {
  const value = (project && typeof project === "object" && "data" in project)
    ? (project as any).data?.project
    : project;
  if (!value || typeof value !== "object") return {};
  const id = clean((value as any).id);
  const name = clean((value as any).name);
  const url = clean((value as any).url);
  return { id, name, url };
}

function applyProjectSummary(inputs: RepoMapInputs, project: unknown) {
  const summary = projectSummary(project);
  if (summary.id) inputs.linearProjectId = summary.id;
  if (summary.name) inputs.linearProject = summary.name;
  return summary;
}

function hasProjectContext(inputs: RepoMapInputs) {
  return Boolean(clean(inputs.linearProjectId) || clean(inputs.linearProject));
}

function projectContextLabel(inputs: RepoMapInputs) {
  const name = clean(inputs.linearProject) || "unknown Linear Project";
  const id = clean(inputs.linearProjectId) || "unresolved-project-id";
  return `Project ${name} (${id})`;
}

function fieldPrompt(field: (typeof FIELD_ORDER)[number], inputs: RepoMapInputs) {
  if (field.key === "linearProject") {
    return {
      title: "Linear Project ID / name for repo-map target",
      placeholder: "Select the target Linear Project before GitHub/local repo fields."
    };
  }
  const context = projectContextLabel(inputs);
  return {
    title: `Complete ${field.title} for ${context}`,
    placeholder: `${context}: ${field.placeholder}`
  };
}

function openQuestions(fields = FIELD_ORDER, inputs: RepoMapInputs = {}) {
  return fields.map(field => {
    if (field.key === "linearProject" && !hasProjectContext(inputs)) {
      return "Choose the target Linear Project ID/name before completing repo-map fields.";
    }
    return `Provide ${field.title} for ${projectContextLabel(inputs)} to complete the repo-map draft.`;
  });
}

export function parseGitHubUrl(value: string): { ok: true; owner: string; repo: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) return { ok: true, owner: sshMatch[1], repo: sshMatch[2] };

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (host !== "github.com" || parts.length < 2) {
      return { ok: false, error: "GitHub URL must point to github.com/<owner>/<repo>." };
    }
    return { ok: true, owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
  } catch {
    return { ok: false, error: "GitHub URL is not a valid URL." };
  }
}

export function validateRepoMapInputs(inputs: RepoMapInputs, options: FlowOptions = {}) {
  const cwd = options.cwd || process.cwd();
  const evidenceGaps: string[] = [];

  if (!clean(inputs.linearProjectId)) evidenceGaps.push("Linear Project ID is required as the repo-map anchor.");
  if (!clean(inputs.linearProject)) evidenceGaps.push("Linear Project is required.");
  for (const field of FIELD_ORDER.filter(field => field.key !== "linearProject")) {
    const value = field.key === "localRepoPath" ? cleanLocalRepoPath(inputs.localRepoPath) : clean(inputs[field.key]);
    if (!value) evidenceGaps.push(`${field.title} is required for ${projectContextLabel(inputs)}.`);
  }

  const github = clean(inputs.githubUrl) ? parseGitHubUrl(inputs.githubUrl!) : null;
  if (github && !github.ok) evidenceGaps.push(github.error);

  const localRepoPath = cleanLocalRepoPath(inputs.localRepoPath);
  if (localRepoPath) {
    const resolved = path.resolve(cwd, localRepoPath);
    if (!fs.existsSync(resolved)) evidenceGaps.push(`Local repo path does not exist for ${projectContextLabel(inputs)}: ${resolved}`);
  }

  const repoKey = clean(inputs.repoKey);
  if (repoKey && !/^[a-z0-9][a-z0-9._-]*$/i.test(repoKey)) {
    evidenceGaps.push("Repo key must contain only letters, numbers, dots, underscores, and hyphens.");
  }

  const defaultBranch = clean(inputs.defaultBranch);
  if (defaultBranch && !/^[^\s]+$/.test(defaultBranch)) {
    evidenceGaps.push("Default branch must be a single branch name without whitespace.");
  }

  if (clean(inputs.linearProject) && options.linearProjectResolved === false) {
    evidenceGaps.push(`Linear Project could not be resolved for repo-map target: ${inputs.linearProject}`);
  }

  return { ok: evidenceGaps.length === 0, evidenceGaps };
}

export function buildRepoMapDraft(inputs: RepoMapInputs, options: FlowOptions = {}) {
  const cwd = options.cwd || process.cwd();
  const github = parseGitHubUrl(inputs.githubUrl || "");
  if (!github.ok) throw new Error(github.error);

  const linearProjectName = clean(inputs.linearProject);
  const repoKey = clean(inputs.repoKey);
  const entry = {
    repoKey,
    github: {
      owner: github.owner,
      repo: github.repo,
      defaultBranch: clean(inputs.defaultBranch)
    },
    linear: {
      projectId: clean(inputs.linearProjectId),
      projectName: linearProjectName,
      projectPrefix: repoKey
    },
    localPath: path.resolve(cwd, cleanLocalRepoPath(inputs.localRepoPath) || ""),
    docs: ["README.md", "docs/", "package.json"],
    evidenceWeight: "high"
  };
  const draft = {
    key: repoKey,
    ...entry
  };

  const yamlPreview = YAML.stringify({ version: 1, repos: [entry] }).trimEnd();
  return {
    ok: true,
    status: "draft_ready" as const,
    draft,
    yamlPreview,
    confirmationRequired: true,
    writesPerformed: false,
    evidenceGaps: [] as string[],
    openQuestions: ["Review the repo-map draft and confirm before writing the repo-map local overlay."]
  };
}

export function findLinearProjectInWorkspace(candidate: string, projects: LinearProjectSummary[]) {
  const normalized = candidate.trim().toLowerCase();
  if (!normalized) return undefined;
  return projects.find(project => {
    const values = [project.id, project.name, project.url].filter((value): value is string => Boolean(value));
    return values.some(value => value.trim().toLowerCase() === normalized)
      || Boolean(project.name && project.name.trim().toLowerCase().startsWith(normalized));
  });
}

export function createNonInteractiveRepoMapResult(seed: RepoMapInputs = {}) {
  const missing = FIELD_ORDER.filter(field => !clean(seed[field.key]));
  if (!clean(seed.linearProjectId) && !missing.some(field => field.key === "linearProject")) {
    missing.unshift(FIELD_ORDER[0]);
  }
  const context = hasProjectContext(seed) ? ` Target: ${projectContextLabel(seed)}.` : "";
  return {
    ok: false,
    status: "needs_interactive_input" as const,
    writesPerformed: false,
    draft: null,
    evidenceGaps: [`Pi UI is not available; cannot ask the user for repo-map fields interactively.${context}`],
    openQuestions: openQuestions(missing.length ? missing : FIELD_ORDER, seed)
  };
}

function cancelledResult(fieldTitle: string, inputs: RepoMapInputs) {
  const context = hasProjectContext(inputs) ? ` for ${projectContextLabel(inputs)}` : "";
  return {
    ok: false,
    status: "cancelled" as const,
    writesPerformed: false,
    draft: null,
    evidenceGaps: [`Repo-map clarification${context} was cancelled at ${fieldTitle}.`],
    openQuestions: [`${fieldTitle}${context} was cancelled; repo-map draft is incomplete.`]
  };
}

function evidenceGapResult(inputs: RepoMapInputs, evidenceGaps: string[]) {
  const context = hasProjectContext(inputs) ? [`Repo-map clarification target: ${projectContextLabel(inputs)}.`] : [];
  return {
    ok: false,
    status: "evidence_gap" as const,
    writesPerformed: false,
    draft: null,
    inputs,
    evidenceGaps: [...context, ...evidenceGaps],
    openQuestions: [...context, ...evidenceGaps.map(gap => `Resolve: ${gap}`)]
  };
}

function fieldValidationErrors(field: (typeof FIELD_ORDER)[number], evidenceGaps: string[]) {
  return evidenceGaps.filter(gap =>
    gap.includes(field.title)
    || gap.toLowerCase().includes(String(field.key).toLowerCase())
    || (field.key === "githubUrl" && gap.includes("GitHub URL"))
    || (field.key === "localRepoPath" && gap.includes("Local repo path"))
    || (field.key === "repoKey" && gap.includes("Repo key"))
    || (field.key === "defaultBranch" && gap.includes("Default branch"))
    || (field.key === "linearProject" && gap.includes("Linear Project"))
    || (field.key === "linearProject" && gap.includes("Linear Project ID"))
  );
}

async function askField(ctx: RepoMapAskContext, field: (typeof FIELD_ORDER)[number], options: FlowOptions, inputs: RepoMapInputs): Promise<AskFieldResult> {
  const seeded = clean(inputs[field.key]);
  if (seeded) return { ok: true, value: seeded };

  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  let lastFieldErrors: string[] = [];
  let lastCandidate: RepoMapInputs = inputs;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt = fieldPrompt(field, inputs);
    const answer = clean(await ctx.ui.input(prompt.title, prompt.placeholder));
    if (!answer) return { ok: false, reason: "cancelled", fieldTitle: field.title };

    const candidate = { ...inputs, [field.key]: answer };
    lastCandidate = candidate;
    let linearProjectResolved = options.linearProjectResolved;
    if (field.key === "linearProject" && options.resolveLinearProject) {
      const resolution = await options.resolveLinearProject(answer);
      linearProjectResolved = resolution.ok;
      if (resolution.ok) {
        const summary = projectSummary(resolution.project);
        if (summary.id) candidate.linearProjectId = summary.id;
        if (summary.name) candidate.linearProject = summary.name;
      }
    }
    const validation = validateRepoMapInputs(candidate, {
      ...options,
      linearProjectResolved
    });
    const fieldErrors = fieldValidationErrors(field, validation.evidenceGaps);
    if (fieldErrors.length === 0) return { ok: true, value: answer };
    lastFieldErrors = fieldErrors;
    ctx.ui.notify?.(fieldErrors[0], attempt < maxRetries ? "warning" : "error");
  }

  return { ok: false, reason: "invalid", inputs: lastCandidate, evidenceGaps: lastFieldErrors };
}

export function createNonInteractiveWriteConfirmationResult(inputs: WriteConfirmationInputs = { writePlanPath: "", idempotencyKey: "" }) {
  return {
    ok: false,
    status: "interactive_confirmation_unavailable" as const,
    approved: false,
    writesPerformed: false,
    writePlanPath: clean(inputs.writePlanPath),
    idempotencyKey: clean(inputs.idempotencyKey),
    planDigest: clean(inputs.planDigest),
    evidenceGaps: ["Pi UI is not available; pi_ask_user write_confirmation cannot show the approval UI."],
    openQuestions: [
      "Real Linear write is blocked until pi_ask_user write_confirmation is available, or the user explicitly allows current-conversation text fallback through linear_apply_write_plan."
    ]
  };
}

export async function runWriteConfirmationFlow(ctx: RepoMapAskContext, inputs: WriteConfirmationInputs) {
  const writePlanPath = clean(inputs.writePlanPath);
  const idempotencyKey = clean(inputs.idempotencyKey);
  if (!writePlanPath || !idempotencyKey) {
    return {
      ok: false,
      status: "evidence_gap" as const,
      approved: false,
      writesPerformed: false,
      evidenceGaps: ["write_confirmation requires writePlanPath and idempotencyKey from the exact dry-run write plan."],
      openQuestions: ["Provide writePlanPath and idempotencyKey before requesting write confirmation."]
    };
  }

  if (!ctx.hasUI || typeof ctx.ui.confirm !== "function") {
    return createNonInteractiveWriteConfirmationResult({ ...inputs, writePlanPath, idempotencyKey });
  }

  const message = buildWriteConfirmationMessage({
    writePlanPath,
    idempotencyKey,
    targetProjectSummary: clean(inputs.targetProjectSummary),
    operationsSummary: clean(inputs.operationsSummary),
    risksSummary: clean(inputs.risksSummary),
    nonChangesSummary: clean(inputs.nonChangesSummary),
    planDigest: clean(inputs.planDigest)
  });
  const approved = await ctx.ui.confirm(WRITE_CONFIRMATION_UI_TITLE, message);
  if (!approved) {
    return {
      ok: false,
      status: "cancelled" as const,
      approved: false,
      writesPerformed: false,
      writePlanPath,
      idempotencyKey,
      planDigest: clean(inputs.planDigest),
      confirmationChannel: "ask_user" as const,
      evidenceGaps: ["Write confirmation was cancelled; real Linear write was not applied."],
      openQuestions: ["Review the dry-run write plan and call pi_ask_user(flow=write_confirmation) again if you want to approve."]
    };
  }

  const confirmationText = buildWriteConfirmationText({
    writePlanPath,
    idempotencyKey,
    targetProjectSummary: clean(inputs.targetProjectSummary),
    operationsSummary: clean(inputs.operationsSummary),
    risksSummary: clean(inputs.risksSummary),
    nonChangesSummary: clean(inputs.nonChangesSummary),
    planDigest: clean(inputs.planDigest)
  });

  let artifact;
  try {
    artifact = registerWriteConfirmationArtifact({
      writePlanPath,
      idempotencyKey,
      planDigest: clean(inputs.planDigest),
      confirmationText
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: "duplicate_confirmation" as const,
      approved: false,
      writesPerformed: false,
      writePlanPath,
      idempotencyKey,
      planDigest: clean(inputs.planDigest),
      evidenceGaps: [messageText],
      openQuestions: ["Reuse the existing approval artifact or wait until the prior approval is consumed by linear_apply_write_plan."]
    };
  }

  return {
    ok: true,
    status: "approved" as const,
    approved: true,
    writesPerformed: false,
    approvalArtifact: toApprovalArtifactResponse(artifact),
    confirmationChannel: artifact.confirmationChannel,
    confirmationText: artifact.confirmationText,
    writePlanPath: artifact.writePlanPath,
    idempotencyKey: artifact.idempotencyKey,
    planDigest: artifact.planDigest,
    confirmationId: artifact.confirmationId,
    createdAt: artifact.createdAt,
    expiresAt: artifact.expiresAt
  };
}

export async function runRepoMapAskFlow(ctx: RepoMapAskContext, options: FlowOptions = {}) {
  const inputs: RepoMapInputs = { ...(options.seed || {}) };
  if (!ctx.hasUI) return createNonInteractiveRepoMapResult(inputs);

  for (const field of FIELD_ORDER) {
    if (field.key === "linearProject" && hasProjectContext(inputs)) {
      if (options.resolveLinearProject) {
        const project = clean(inputs.linearProjectId) || clean(inputs.linearProject);
        if (project) {
          const resolution = await options.resolveLinearProject(project);
          if (resolution.ok) applyProjectSummary(inputs, resolution.project);
        }
      }
      continue;
    }
    const answer = await askField(ctx, field, options, inputs);
    if (!answer.ok && answer.reason === "cancelled") return cancelledResult(answer.fieldTitle, inputs);
    if (!answer.ok && answer.reason === "invalid") return evidenceGapResult(answer.inputs, answer.evidenceGaps);
    inputs[field.key] = answer.value;
    if (field.key === "linearProject" && options.resolveLinearProject) {
      const resolution = await options.resolveLinearProject(answer.value);
      if (resolution.ok) applyProjectSummary(inputs, resolution.project);
    }
  }

  const linearProjectResolution = options.resolveLinearProject && inputs.linearProject
    ? await options.resolveLinearProject(inputs.linearProject)
    : { ok: options.linearProjectResolved !== false };
  const validation = validateRepoMapInputs(inputs, {
    ...options,
    linearProjectResolved: linearProjectResolution.ok
  });
  if (!validation.ok) return evidenceGapResult(inputs, validation.evidenceGaps);

  return buildRepoMapDraft(inputs, options);
}

async function resolveLinearProjectWithCli(pi: ExtensionAPI, signal: AbortSignal | undefined, project: string): Promise<LinearResolution> {
  const result = await pi.exec("node", ["scripts/linear-cli.mjs", "project", project], { signal, timeout: 120000 });
  let directError = result.stderr || result.stdout || `linear-cli exited ${result.code}`;
  try {
    const parsed = JSON.parse(result.stdout);
    if (result.code === 0 && parsed?.ok && parsed?.data?.project) return { ok: true, project: parsed.data.project };
    directError = `Linear Project not found: ${project}`;
  } catch (err) {
    directError = err instanceof Error ? err.message : String(err);
  }

  const workspace = await pi.exec("node", ["scripts/linear-cli.mjs", "workspace"], { signal, timeout: 120000 });
  if (workspace.code !== 0) return { ok: false, error: workspace.stderr || directError };
  try {
    const parsed = JSON.parse(workspace.stdout);
    const match = findLinearProjectInWorkspace(project, parsed?.projects || []);
    return match ? { ok: true, project: match } : { ok: false, error: directError };
  } catch {
    return { ok: false, error: directError };
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "pi_ask_user",
    label: "Ask User",
    description: "Ask the user to choose a local project, complete repo-map fields, or approve an exact Linear write plan. Never performs Linear mutations by itself.",
    parameters: Type.Object({
      flow: Type.Optional(Type.String({ description: "Supports project_select, repo_map, and write_confirmation." })),
      seed: Type.Optional(Type.Object({
        projectId: Type.Optional(Type.String()),
        githubUrl: Type.Optional(Type.String()),
        linearProjectId: Type.Optional(Type.String()),
        linearProject: Type.Optional(Type.String()),
        localRepoPath: Type.Optional(Type.String()),
        repoKey: Type.Optional(Type.String()),
        defaultBranch: Type.Optional(Type.String())
      })),
      writePlanPath: Type.Optional(Type.String()),
      idempotencyKey: Type.Optional(Type.String()),
      targetProjectSummary: Type.Optional(Type.String()),
      operationsSummary: Type.Optional(Type.String()),
      risksSummary: Type.Optional(Type.String()),
      nonChangesSummary: Type.Optional(Type.String()),
      planDigest: Type.Optional(Type.String()),
      repoMapPath: Type.Optional(Type.String()),
      localRepoMapPath: Type.Optional(Type.String()),
      customLabel: Type.Optional(Type.String()),
      maxRetries: Type.Optional(Type.Number({ default: 2 }))
    }),
    promptSnippet: "pi_ask_user: Pi UI for project selection, repo-map clarification, or write-plan approval.",
    promptGuidelines: [
      "For single-project planning/reporting/review tasks without an explicit target, call pi_ask_user with flow=project_select before reading Linear.",
      "Project selection options must come from the local repo-map, with User input as the last option; do not list projects from Linear before the user selects one.",
      "Use pi_ask_user for repo-map gaps when GitHub, Linear Project, and local repo facts do not line up.",
      "After linear_apply_write_plan dry-run succeeds, call pi_ask_user with flow=write_confirmation once to show Approve & Write / Cancel for the exact writePlanPath, idempotencyKey, and dry-run summaries.",
      "When the user clicks Approve & Write, immediately call linear_apply_write_plan(dryRun=false) with the returned approval artifact. Do not show a second confirmation UI.",
      "write_confirmation only collects approval; it does not execute Linear mutations.",
      "If write_confirmation returns interactive_confirmation_unavailable or cancelled, do not call linear_apply_write_plan with dryRun=false unless the user explicitly allows conversation fallback.",
      "Ask one field at a time for repo_map; do not present a multi-field table.",
      "If the result is cancelled or needs_interactive_input, do not modify repo-map files.",
      "The returned repo-map draft is review-only; apply it with repo-map-drift only after separate explicit confirmation; the default target is the local overlay, not tracked config."
    ],
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (params.flow === "project_select") {
        const result = await runProjectSelectionFlow(ctx, {
          cwd: process.cwd(),
          repoMapPath: params.repoMapPath,
          localRepoMapPath: params.localRepoMapPath,
          seed: params.seed,
          customLabel: params.customLabel
        });
        return text(result);
      }

      if (params.flow === "write_confirmation") {
        const result = await runWriteConfirmationFlow(ctx, {
          writePlanPath: params.writePlanPath || "",
          idempotencyKey: params.idempotencyKey || "",
          targetProjectSummary: params.targetProjectSummary,
          operationsSummary: params.operationsSummary,
          risksSummary: params.risksSummary,
          nonChangesSummary: params.nonChangesSummary,
          planDigest: params.planDigest
        });
        return text(result);
      }

      if (params.flow && params.flow !== "repo_map") {
        return text({ ok: false, status: "unsupported_flow", evidenceGaps: [`Unsupported pi_ask_user flow: ${params.flow}`], writesPerformed: false });
      }

      const result = await runRepoMapAskFlow(ctx, {
        cwd: process.cwd(),
        repoMapPath: params.repoMapPath,
        localRepoMapPath: params.localRepoMapPath,
        seed: params.seed,
        maxRetries: params.maxRetries,
        resolveLinearProject: project => resolveLinearProjectWithCli(pi, signal, project)
      });
      return text(result);
    }
  });
}
