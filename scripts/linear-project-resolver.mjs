const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function compactProject(project) {
  return {
    id: project.id || null,
    name: project.name || null,
    url: project.url || null,
    state: project.state || null,
    active: project.active ?? (!project.archivedAt && !['canceled', 'completed'].includes(project.state))
  };
}

export function linearProjectUrlParts(locator) {
  const input = clean(locator);
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment);
    const projectIndex = segments.findIndex(segment => segment.toLowerCase() === 'project');
    const workspaceSlug = projectIndex > 0 ? segments[0] : null;
    const slug = projectIndex >= 0 ? segments[projectIndex + 1] || null : null;
    const isLinearProjectUrl = Boolean(host === 'linear.app' && workspaceSlug && slug);
    const normalizedProjectUrl = isLinearProjectUrl
      ? `https://${host}/${workspaceSlug}/project/${slug}`.toLowerCase()
      : null;
    return { isLinearProjectUrl, workspaceSlug, slug, normalizedProjectUrl };
  } catch {
    return { isLinearProjectUrl: false, workspaceSlug: null, slug: null, normalizedProjectUrl: null };
  }
}

function projectSlug(project) {
  return linearProjectUrlParts(project.url).slug;
}

function projectUrl(project) {
  return linearProjectUrlParts(project.url).normalizedProjectUrl;
}

export function matchWorkspaceProjects(locator, projects = []) {
  const input = clean(locator);
  const normalized = lower(input);
  const urlParts = linearProjectUrlParts(input);
  const slug = lower(urlParts.slug || input);

  const matchers = [
    {
      source: 'workspace_id',
      test: project => UUID_RE.test(normalized) && lower(project.id) === normalized
    },
    {
      source: 'workspace_url',
      test: project => Boolean(urlParts.normalizedProjectUrl && projectUrl(project) === urlParts.normalizedProjectUrl)
    },
    {
      source: 'workspace_slug',
      test: project => Boolean(slug && lower(projectSlug(project)) === slug)
    },
    {
      source: 'workspace_exact_name',
      test: project => lower(project.name) === normalized
    }
  ];

  for (const matcher of matchers) {
    const matches = projects.filter(project => matcher.test(project)).map(project => ({ source: matcher.source, project }));
    if (matches.length) return matches;
  }
  return [];
}

function selectionGap(locator, matches, projects, directError = null) {
  const hasMatches = matches.length > 0;
  const candidates = (hasMatches ? matches.map(match => match.project) : projects)
    .slice(0, 8)
    .map(compactProject);
  return {
    ok: false,
    type: 'project_selection_gap',
    locator: clean(locator),
    message: hasMatches
      ? `Linear Project locator matched multiple workspace projects: ${clean(locator)}`
      : `Linear Project could not be resolved from locator: ${clean(locator)}`,
    directError,
    candidates
  };
}

function asProject(value) {
  const project = value?.data?.project || value?.project || value;
  return project?.id ? project : null;
}

export async function resolveLinearProjectId(locator, options) {
  const input = clean(locator);
  let directError = null;

  if (!input) return selectionGap(input, [], [], null);

  if (typeof options?.directLookup === 'function') {
    try {
      const directProject = asProject(await options.directLookup(input));
      if (directProject) {
        return {
          ok: true,
          source: 'direct',
          locator: input,
          resolvedProjectId: directProject.id,
          project: directProject
        };
      }
    } catch (err) {
      directError = err instanceof Error ? err.message : String(err);
    }
  }

  const projects = typeof options?.workspaceProjects === 'function'
    ? await options.workspaceProjects()
    : [];
  const matches = matchWorkspaceProjects(input, projects || []);

  if (matches.length === 1) {
    const match = matches[0];
    return {
      ok: true,
      source: match.source,
      locator: input,
      resolvedProjectId: match.project.id,
      project: match.project,
      directError
    };
  }

  return selectionGap(input, matches, projects || [], directError);
}
