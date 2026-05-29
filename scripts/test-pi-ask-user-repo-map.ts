import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRepoMapDraft,
  createNonInteractiveRepoMapResult,
  findLinearProjectInWorkspace,
  runRepoMapAskFlow,
  validateRepoMapInputs
} from '../.pi/extensions/pi-ask-user.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ask-user-repo-map-'));
const existingRepo = path.join(tempRoot, 'linear-bridge');
fs.mkdirSync(existingRepo);

const validAnswers = {
  githubUrl: 'https://github.com/w2030298-art/linear-bridge',
  linearProject: 'linear-bridge｜Linear 与本地 Agent 的派发桥',
  localRepoPath: existingRepo,
  repoKey: 'linear-bridge',
  defaultBranch: 'main'
};

{
  const project = findLinearProjectInWorkspace('linear-bridge｜Linear 与本地 Agent 的派发桥', [
    { id: 'project-id-1', name: 'linear-pi-project-admin-agent｜Linear 项目管理员 Agent 运行时' },
    { id: 'project-id-2', name: 'linear-bridge｜Linear 与本地 Agent 的派发桥' }
  ]);
  assert.equal(project?.id, 'project-id-2');
}

{
  const validation = validateRepoMapInputs(validAnswers, {
    cwd: process.cwd(),
    linearProjectResolved: true
  });
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.evidenceGaps, []);

  const draft = buildRepoMapDraft(validAnswers, { cwd: process.cwd() });
  assert.equal(draft.draft.key, 'linear-bridge');
  assert.equal(draft.draft.owner, 'w2030298-art');
  assert.equal(draft.draft.repo, 'linear-bridge');
  assert.equal(draft.draft.defaultBranch, 'main');
  assert.equal(draft.draft.localPath, path.resolve(existingRepo));
  assert.equal(draft.draft.linearProjectName, validAnswers.linearProject);
  assert.match(draft.yamlPreview, /key: linear-bridge/);
  assert.match(draft.yamlPreview, /owner: w2030298-art/);
  assert.equal(draft.confirmationRequired, true);
  assert.equal(draft.writesPerformed, false);
}

{
  const missingPath = validateRepoMapInputs(
    { ...validAnswers, localRepoPath: path.join(tempRoot, 'missing') },
    { cwd: process.cwd(), linearProjectResolved: true }
  );
  assert.equal(missingPath.ok, false);
  assert.match(missingPath.evidenceGaps.join('\n'), /local repo path does not exist/i);
}

{
  const fallback = createNonInteractiveRepoMapResult({ repoKey: 'linear-bridge' });
  assert.equal(fallback.ok, false);
  assert.equal(fallback.status, 'needs_interactive_input');
  assert.equal(fallback.writesPerformed, false);
  assert.match(fallback.evidenceGaps.join('\n'), /Pi UI is not available/i);
}

{
  const asked: string[] = [];
  const answers = [
    validAnswers.githubUrl,
    validAnswers.linearProject,
    validAnswers.localRepoPath,
    validAnswers.repoKey,
    validAnswers.defaultBranch
  ];
  const ctx = {
    hasUI: true,
    ui: {
      async input(title: string) {
        asked.push(title);
        return answers.shift();
      },
      notify() {}
    }
  };
  const result = await runRepoMapAskFlow(ctx, {
    cwd: process.cwd(),
    resolveLinearProject: async () => ({ ok: true })
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'draft_ready');
  assert.equal(result.draft.key, 'linear-bridge');
  assert.deepEqual(asked, [
    'GitHub URL',
    'Linear Project',
    'Local repo path',
    'Repo key',
    'Default branch'
  ]);
}

{
  const ctx = {
    hasUI: true,
    ui: {
      async input() {
        return undefined;
      },
      notify() {}
    }
  };
  const result = await runRepoMapAskFlow(ctx, {
    cwd: process.cwd(),
    resolveLinearProject: async () => ({ ok: true })
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.writesPerformed, false);
  assert.match(result.openQuestions.join('\n'), /GitHub URL/);
}

{
  const answers = [
    validAnswers.githubUrl,
    validAnswers.linearProject,
    path.join(tempRoot, 'missing'),
    path.join(tempRoot, 'still-missing')
  ];
  const ctx = {
    hasUI: true,
    ui: {
      async input() {
        return answers.shift();
      },
      notify() {}
    }
  };
  const result = await runRepoMapAskFlow(ctx, {
    cwd: process.cwd(),
    maxRetries: 1,
    resolveLinearProject: async () => ({ ok: true })
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'evidence_gap');
  assert.equal(result.writesPerformed, false);
  assert.match(result.evidenceGaps.join('\n'), /local repo path does not exist/i);
}

console.log('pi ask user repo-map tests passed');
