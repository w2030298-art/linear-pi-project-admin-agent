const DIFFICULTY_NAMES = new Set(['High-difficulty', 'Medium-difficulty', 'Low-difficulty']);
const READY_NAMES = new Set(['Ready', '准备开始']);
const IN_PROGRESS_NAMES = new Set(['In Progress', '进行中', 'In Review', '审核中']);
const BACKLOG_NAMES = new Set(['Backlog', '积压']);
const TODO_NAMES = new Set(['Todo', '待办']);
const BLOCKED_NAMES = new Set(['Blocked', '阻塞']);
const TERMINAL_TYPES = new Set(['completed', 'canceled', 'duplicate']);

export function priorityLabel(priority) {
  return ({ 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low', 0: 'None' }[priority] || String(priority ?? 'None'));
}

export function stateBucket(issue) {
  const name = issue?.state?.name || 'Unknown';
  const type = issue?.state?.type || '';
  if (type === 'completed') return 'Done';
  if (type === 'canceled') return 'Canceled';
  if (type === 'duplicate') return 'Duplicate';
  if (READY_NAMES.has(name)) return 'Ready';
  if (IN_PROGRESS_NAMES.has(name) || type === 'started') return 'InProgress';
  if (BLOCKED_NAMES.has(name)) return 'Blocked';
  if (BACKLOG_NAMES.has(name) || type === 'backlog') return 'Backlog';
  if (TODO_NAMES.has(name) || type === 'unstarted') return 'Todo';
  if (type === 'triage') return 'Triage';
  return name;
}

export function isTerminalIssue(issue) {
  return TERMINAL_TYPES.has(issue?.state?.type);
}

function issueDigest(issue) {
  return {
    identifier: issue.identifier,
    title: issue.title,
    state: issue.state?.name
  };
}

export function summarizeIssueRelations(issue) {
  const relations = issue?.relations?.nodes || [];
  const inverseRelations = issue?.inverseRelations?.nodes || [];
  const blocks = relations
    .filter(relation => relation.type === 'blocks')
    .map(relation => issueDigest(relation.relatedIssue));
  const blockedBy = inverseRelations
    .filter(relation => relation.type === 'blocks' && !isTerminalIssue(relation.issue))
    .map(relation => issueDigest(relation.issue));
  return { blocks, blockedBy };
}

export function countOpenIssues(issues) {
  return issues.filter(issue => !isTerminalIssue(issue)).length;
}

export function summarizeCycle(cycle, issues, blockedIdentifiers = new Set()) {
  const cycleIssues = issues.filter(issue => issue.cycle?.id === cycle.id);
  const completedCount = cycleIssues.filter(issue => stateBucket(issue) === 'Done').length;
  const openIssues = cycleIssues.filter(issue => !isTerminalIssue(issue));
  const highOpenCount = openIssues.filter(issue =>
    (issue.labels?.nodes || []).some(label => label.name === 'High-difficulty')
  ).length;
  const blockedCount = openIssues.filter(issue =>
    stateBucket(issue) === 'Blocked' || blockedIdentifiers.has(issue.identifier)
  ).length;

  return {
    id: cycle.id,
    number: cycle.number,
    name: cycle.name,
    startsAt: cycle.startsAt,
    endsAt: cycle.endsAt,
    issueCount: cycleIssues.length,
    completedCount,
    openCount: openIssues.length,
    highOpenCount,
    blockedCount,
    issues: cycleIssues.map(issue => ({
      identifier: issue.identifier,
      title: issue.title,
      state: issue.state?.name,
      difficulty: (issue.labels?.nodes || []).find(label => DIFFICULTY_NAMES.has(label.name))?.name || null
    }))
  };
}

export function cycleWindowStatus(cycle, now = new Date()) {
  const start = new Date(cycle.startsAt);
  const end = new Date(cycle.endsAt);
  if (start <= now && now < end) return 'current';
  return start > now ? 'future' : 'past';
}

export function difficultyNames() {
  return DIFFICULTY_NAMES;
}
