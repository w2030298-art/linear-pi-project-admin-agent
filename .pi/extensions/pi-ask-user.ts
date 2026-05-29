import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import YAML from "yaml";

type InputValue = string | undefined;

export interface RepoMapInputs {
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
  seed?: RepoMapInputs;
  maxRetries?: number;
  linearProjectResolved?: boolean;
  resolveLinearProject?: (project: string) => Promise<LinearResolution>;
}

interface RepoMapAskContext {
  hasUI: boolean;
  ui: {
    input(title: string, placeholder?: string): Promise<InputValue>;
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

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

function clean(value: InputValue) {
  const trimmed = value?.trim();
  return trimmed || undefined;
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
    if (!clean(inputs[field.key])) evidenceGaps.push(`${field.title} is required for ${projectContextLabel(inputs)}.`);
  }

  const github = clean(inputs.githubUrl) ? parseGitHubUrl(inputs.githubUrl!) : null;
  if (github && !github.ok) evidenceGaps.push(github.error);

  const localRepoPath = clean(inputs.localRepoPath);
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
    localPath: path.resolve(cwd, inputs.localRepoPath || ""),
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
    openQuestions: ["Review the repo-map draft and confirm before writing config/repo-map.yaml."]
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
    description: "Ask the user for repo-map fields one at a time and return a reviewable draft. Never writes config by itself.",
    parameters: Type.Object({
      flow: Type.Optional(Type.String({ description: "Currently supports repo_map only." })),
      seed: Type.Optional(Type.Object({
        githubUrl: Type.Optional(Type.String()),
        linearProjectId: Type.Optional(Type.String()),
        linearProject: Type.Optional(Type.String()),
        localRepoPath: Type.Optional(Type.String()),
        repoKey: Type.Optional(Type.String()),
        defaultBranch: Type.Optional(Type.String())
      })),
      maxRetries: Type.Optional(Type.Number({ default: 2 }))
    }),
    promptSnippet: "pi_ask_user: uses Pi UI to ask one repo-map field at a time and returns a draft that still needs confirmation.",
    promptGuidelines: [
      "Use pi_ask_user for repo-map gaps when GitHub, Linear Project, and local repo facts do not line up.",
      "Ask one field at a time; do not present a multi-field table.",
      "If the result is cancelled or needs_interactive_input, do not modify config/repo-map.yaml.",
      "The returned repo-map draft is review-only; write config/repo-map.yaml only after separate explicit confirmation."
    ],
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (params.flow && params.flow !== "repo_map") {
        return text({ ok: false, status: "unsupported_flow", evidenceGaps: [`Unsupported pi_ask_user flow: ${params.flow}`], writesPerformed: false });
      }

      const result = await runRepoMapAskFlow(ctx, {
        cwd: process.cwd(),
        seed: params.seed,
        maxRetries: params.maxRetries,
        resolveLinearProject: project => resolveLinearProjectWithCli(pi, signal, project)
      });
      return text(result);
    }
  });
}
