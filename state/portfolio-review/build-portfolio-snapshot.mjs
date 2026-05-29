import { LinearClient } from '@linear/sdk';
import fs from 'node:fs';
import '../../scripts/utils.mjs';
import {
  cycleWindowStatus,
  difficultyNames,
  isTerminalIssue,
  priorityLabel,
  stateBucket,
  summarizeCycle,
  summarizeIssueRelations
} from '../../scripts/portfolio-snapshot-utils.mjs';

const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
const now = new Date('2026-05-28T12:10:00Z');
const today = '2026-05-28';
const outPath = 'state/portfolio-review/portfolio-snapshot-2026-05-28.json';

const difficultyNameSet = difficultyNames();

function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((now - new Date(iso)) / 86400000);
}
function daysUntilDate(date) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00Z`);
  return Math.ceil((d - new Date(`${today}T00:00:00Z`)) / 86400000);
}
function bodySummary(body) {
  if (!body) return '';
  return body.replace(/\s+/g,' ').trim().slice(0, 260);
}
async function gql(query, vars = {}) {
  const res = await linear.client.rawRequest(query, vars);
  return res.data;
}

const projectsData = await gql(`query Projects { projects(first: 100) { nodes { id name url state createdAt updatedAt startDate targetDate archivedAt } } }`);
const cycleData = await gql(`query Cycles { cycles(first: 30) { nodes { id number name startsAt endsAt completedAt team { key name } } } }`);
let workflowStates = [];
try {
  const teamsData = await gql(`query Teams { teams(first: 20) { nodes { id key name states { nodes { id name type position } } } } }`);
  workflowStates = teamsData.teams.nodes.flatMap(t => t.states.nodes.map(s => ({...s, teamKey:t.key})));
} catch (_e) {
  workflowStates = [];
}

const activeProjectHeaders = projectsData.projects.nodes.filter(p => !p.archivedAt && !['canceled','completed'].includes(p.state));
const inactiveProjectHeaders = projectsData.projects.nodes.filter(p => !p.archivedAt && ['canceled','completed'].includes(p.state));

const projectQuery = `query Project($id:String!) {
  project(id:$id) {
    id name description url state createdAt updatedAt startDate targetDate archivedAt
    projectMilestones(first:50) { nodes { id name description targetDate sortOrder } }
    projectUpdates(first:3) { nodes { id body url createdAt updatedAt health } }
    issues(first:250) { nodes {
      id identifier title priority url createdAt updatedAt archivedAt
      state { id name type }
      labels { nodes { id name } }
      assignee { id name }
      cycle { id number name startsAt endsAt }
      projectMilestone { id name targetDate }
    } }
  }
}`;

const relationQuery = `query IssueRelations($id:String!) {
  issue(id:$id) {
    id identifier
    relations(first:20) { nodes { id type relatedIssue { id identifier title state { name type } } } }
    inverseRelations(first:20) { nodes { id type issue { id identifier title state { name type } } } }
  }
}`;

const projects = [];
for (const header of activeProjectHeaders) {
  const data = await gql(projectQuery, {id: header.id});
  const p = data.project;
  const issues = p.issues.nodes.filter(i => !i.archivedAt);
  for (const i of issues.filter(i => !isTerminalIssue(i))) {
    const rel = await gql(relationQuery, {id: i.id});
    i.relations = rel.issue.relations;
    i.inverseRelations = rel.issue.inverseRelations;
  }
  for (const i of issues.filter(i => isTerminalIssue(i))) {
    i.relations = { nodes: [] };
    i.inverseRelations = { nodes: [] };
  }
  const counts = { total: issues.length, Done:0, Canceled:0, Duplicate:0, Ready:0, InProgress:0, Blocked:0, Todo:0, Backlog:0, Triage:0, Other:0 };
  for (const i of issues) {
    const b = stateBucket(i);
    if (counts[b] !== undefined) counts[b]++; else counts.Other++;
  }
  const nonCanceled = issues.filter(i => !['Canceled','Duplicate'].includes(stateBucket(i)));
  const done = issues.filter(i => stateBucket(i) === 'Done');
  const doneRatio = nonCanceled.length ? Math.round(done.length / nonCanceled.length * 100) : 0;
  const milestoneStats = p.projectMilestones.nodes.map(m => {
    const mis = issues.filter(i => i.projectMilestone?.id === m.id);
    const mdone = mis.filter(i => stateBucket(i) === 'Done').length;
    return { id:m.id, name:m.name, targetDate:m.targetDate, issueCount:mis.length, doneCount:mdone, openCount:mis.length-mdone, overdue: !!m.targetDate && m.targetDate < today && (mis.length-mdone)>0 };
  });
  const missingDifficulty = issues.filter(i => !isTerminalIssue(i) && !i.labels.nodes.some(l => difficultyNameSet.has(l.name))).map(i => i.identifier);
  const missingMilestone = issues.filter(i => !isTerminalIssue(i) && !i.projectMilestone).map(i => i.identifier);
  const inProgressNoAssignee = issues.filter(i => stateBucket(i)==='InProgress' && !i.assignee).map(i => i.identifier);
  const unresolvedBlockedBy = new Map();
  const blocksCount = new Map();
  const relationDigest = [];
  for (const i of issues) {
    const { blocks, blockedBy: blockers } = summarizeIssueRelations(i);
    if (blockers.length) unresolvedBlockedBy.set(i.identifier, blockers);
    const blockNodes = i.relations.nodes.filter(r => r.type === 'blocks');
    blocksCount.set(i.identifier, blockNodes.filter(r => !isTerminalIssue(r.relatedIssue)).length);
    if (blockers.length || blocks.length) relationDigest.push({issue:i.identifier, blockedBy:blockers, blocks});
  }
  const blockedIssueCount = new Set([...issues.filter(i=>stateBucket(i)==='Blocked').map(i=>i.identifier), ...unresolvedBlockedBy.keys()]).size;
  const cycles = {};
  for (const cycle of new Map(issues.filter(i => i.cycle).map(i => [i.cycle.id, i.cycle])).values()) {
    cycles[cycle.id] = summarizeCycle(cycle, issues, new Set(unresolvedBlockedBy.keys()));
  }

  const latestUpdate = p.projectUpdates.nodes[0] || null;
  const candidatesRaw = issues.filter(i => {
    const bucket = stateBucket(i);
    if (!(bucket === 'Todo' || bucket === 'Backlog')) return false;
    if (unresolvedBlockedBy.has(i.identifier)) return false;
    return true;
  });
  const scoredCandidates = candidatesRaw.map(i => {
    const priorityScore = ({1:100,2:75,3:50,4:25,0:10}[i.priority ?? 0] ?? 10);
    const du = daysUntilDate(i.projectMilestone?.targetDate || null);
    const milestoneScore = du === null ? 20 : (du <= 7 ? 100 : du <= 14 ? 70 : du <= 30 ? 40 : 10);
    const blockInfluenceScore = Math.min(100, (blocksCount.get(i.identifier) || 0) * 25);
    const hasAnyBlockers = i.inverseRelations.nodes.some(r => r.type === 'blocks');
    const dependencyScore = hasAnyBlockers ? 100 : 80;
    const statusScore = stateBucket(i)==='Todo' ? 100 : 50;
    const score = Math.round(priorityScore*0.30 + milestoneScore*0.25 + blockInfluenceScore*0.25 + dependencyScore*0.10 + statusScore*0.10);
    return {
      identifier: i.identifier,
      title: i.title,
      state: i.state.name,
      priority: priorityLabel(i.priority),
      milestone: i.projectMilestone?.name || null,
      cycle: i.cycle ? `#${i.cycle.number}` : null,
      labels: i.labels.nodes.map(l=>l.name),
      score,
      scoring: {priorityScore,milestoneScore,blockInfluenceScore,dependencyScore,statusScore},
      blocks: i.relations.nodes.filter(r=>r.type==='blocks').map(r=>r.relatedIssue.identifier)
    };
  }).sort((a,b)=>b.score-a.score);

  const readyInProgress = counts.Ready + counts.InProgress;
  let recommendedReady = [];
  if (readyInProgress < 3) {
    const capacity = Math.max(1, 3 - readyInProgress);
    recommendedReady = scoredCandidates.slice(0, capacity);
  }

  const suggestions = [];
  if (!latestUpdate) suggestions.push({type:'status_update', severity:'medium', text:'缺失项目状态更新，建议发布首条巡检状态更新。'});
  else if (daysAgo(latestUpdate.createdAt) > 14) suggestions.push({type:'status_update', severity:'medium', text:`最近状态更新 ${daysAgo(latestUpdate.createdAt)} 天前，建议发布新状态更新。`});
  else if (daysAgo(latestUpdate.createdAt) > 7) suggestions.push({type:'status_update', severity:'low', text:`最近状态更新 ${daysAgo(latestUpdate.createdAt)} 天前，可考虑补充进展。`});
  if (latestUpdate?.health === 'onTrack' && (milestoneStats.some(m=>m.overdue) || blockedIssueCount >= 2)) suggestions.push({type:'health', severity:'medium', text:'最近 health 为 onTrack，但存在逾期 Milestone 或多个阻塞 Issue，建议评估是否改为 atRisk。'});
  if (p.state === 'started' && readyInProgress === 0) suggestions.push({type:'issue_flow', severity:'high', text:'项目已 started，但无 Ready/In Progress Issue，建议推进 1 个可执行 Issue 到 Ready。'});
  if (counts.InProgress > 5) suggestions.push({type:'focus', severity:'medium', text:`In Progress ${counts.InProgress} 个，单人项目并行过多，建议聚焦。`});
  if (doneRatio > 80 && p.state !== 'completed') suggestions.push({type:'close_check', severity:'low', text:`Done 比例 ${doneRatio}%，建议检查剩余 Issue，满足后关闭项目或收口。`});
  const labelCoverage = issues.length ? Math.round((issues.length - missingDifficulty.length) / issues.length * 100) : 100;
  if (labelCoverage < 80) suggestions.push({type:'label', severity:'medium', text:`Task-difficulty label 覆盖率 ${labelCoverage}%，低于 80%，需补充：${missingDifficulty.join(', ')}`});
  if (missingMilestone.length) suggestions.push({type:'milestone', severity:'medium', text:`存在无 Milestone 的未完成 Issue：${missingMilestone.join(', ')}`});
  if (inProgressNoAssignee.length) suggestions.push({type:'assignee', severity:'low', text:`存在 In Progress 但无负责人 Issue：${inProgressNoAssignee.join(', ')}`});
  const milestonesNoTarget = p.projectMilestones.nodes.filter(m=>!m.targetDate).map(m=>m.name);
  if (milestonesNoTarget.length) suggestions.push({type:'milestone_date', severity:'low', text:`Milestone 缺少目标日期：${milestonesNoTarget.slice(0,5).join('；')}${milestonesNoTarget.length>5?' 等':''}`});

  projects.push({
    id:p.id, name:p.name, url:p.url, state:p.state, targetDate:p.targetDate, startDate:p.startDate, updatedAt:p.updatedAt,
    latestUpdate: latestUpdate ? {createdAt:latestUpdate.createdAt, daysAgo:daysAgo(latestUpdate.createdAt), health:latestUpdate.health, url:latestUpdate.url, summary:bodySummary(latestUpdate.body)} : null,
    issueCounts: counts,
    doneRatio,
    milestoneStats,
    labelCoverage,
    missingDifficulty,
    missingMilestone,
    inProgressNoAssignee,
    blockedIssueCount,
    relationDigest,
    cycles: Object.values(cycles).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt)),
    recommendedReady,
    topCandidates: scoredCandidates.slice(0,5),
    suggestions,
    issues: issues.map(i=>({
      id:i.id, identifier:i.identifier, title:i.title, state:i.state.name, stateType:i.state.type, bucket:stateBucket(i), priority:priorityLabel(i.priority), assignee:i.assignee?.name||null,
      milestone:i.projectMilestone?.name||null, milestoneTarget:i.projectMilestone?.targetDate||null, cycle:i.cycle?{id:i.cycle.id,number:i.cycle.number,startsAt:i.cycle.startsAt,endsAt:i.cycle.endsAt}:null,
      labels:i.labels.nodes.map(l=>l.name), updatedAt:i.updatedAt,
      blockedBy:(unresolvedBlockedBy.get(i.identifier)||[]).map(b=>b.identifier),
      blocks:i.relations.nodes.filter(r=>r.type==='blocks').map(r=>r.relatedIssue.identifier)
    }))
  });
}

const cycles = cycleData.cycles.nodes
  .sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt))
  .map(c => ({...c, status: cycleWindowStatus(c, now)}));

const result = {
  ok:true,
  sourceType:'linear_live',
  collectedAt:new Date().toISOString(),
  reportDate: today,
  factPackPath:'state/fact-packs/fact-ea42051c1339.json',
  activeProjectsScanned: projects.length,
  inactiveProjectsExcluded: inactiveProjectHeaders.map(p=>({id:p.id,name:p.name,state:p.state,url:p.url})),
  workflowStates,
  cycles,
  projects
};
fs.writeFileSync(outPath, JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:true,outPath,activeProjects:projects.length,inactiveExcluded:result.inactiveProjectsExcluded.length,projects:projects.map(p=>({name:p.name,issues:p.issueCounts,totalSuggestions:p.suggestions.length,recommendedReady:p.recommendedReady.map(i=>i.identifier)}))},null,2));
