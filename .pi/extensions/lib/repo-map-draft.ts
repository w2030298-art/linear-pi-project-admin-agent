import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { parseGitHubUrl } from "./github-url.ts";

type InputValue = string | undefined;

export interface RepoMapInputs {
  projectId?: string;
  linearProjectId?: string;
  githubUrl?: string;
  linearProject?: string;
  localRepoPath?: string;
  repoKey?: string;
  defaultBranch?: string;
}

interface LinearProjectSummary {
  id?: string;
  name?: string;
  url?: string;
}

export interface FlowOptions {
  cwd?: string;
  repoMapPath?: string;
  localRepoMapPath?: string;
  seed?: RepoMapInputs;
  maxRetries?: number;
  linearProjectResolved?: boolean;
  resolveLinearProject?: (project: string) => Promise<{ ok: boolean; error?: string; project?: unknown }>;
}

export interface RepoMapAskContext {
  hasUI: boolean;
  ui: {
    input(title: string, placeholder?: string): Promise<InputValue>;
    select?(title: string, options: string[]): Promise<InputValue>;
    confirm?(title: string, message: string): Promise<boolean>;
    notify?(message: string, type?: "info" | "warning" | "error"): void;
  };
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
  if (github?.ok === false) evidenceGaps.push(github.error);

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
  if (github.ok === false) throw new Error(github.error);

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
    if (answer.ok === false && answer.reason === "cancelled") return cancelledResult(answer.fieldTitle, inputs);
    if (answer.ok === false && answer.reason === "invalid") return evidenceGapResult(answer.inputs, answer.evidenceGaps);
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
