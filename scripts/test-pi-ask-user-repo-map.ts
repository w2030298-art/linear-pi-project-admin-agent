import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRepoMapDraft,
  CUSTOM_PROJECT_INPUT_LABEL,
  createNonInteractiveRepoMapResult,
  findLinearProjectInWorkspace,
  listRegisteredProjectChoices,
  runProjectSelectionFlow,
  runRepoMapAskFlow,
  validateRepoMapInputs
} from '../.pi/extensions/pi-ask-user.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ask-user-repo-map-'));
const existingRepo = path.join(tempRoot, 'linear-bridge');
fs.mkdirSync(existingRepo);

const validAnswers = {
  linearProjectId: 'project-id-2',
  githubUrl: 'https://github.com/w2030298-art/linear-bridge',
  linearProject: 'linear-bridge Linear dispatch bridge',
  localRepoPath: existingRepo,
  repoKey: 'linear-bridge',
  defaultBranch: 'main'
};

const repoMapPath = path.join(tempRoot, 'repo-map.yaml');
const localRepoMapPath = path.join(tempRoot, 'repo-map.local.yaml');
const projectAPath = path.join(tempRoot, 'selection-project-a');
const projectBPath = path.join(tempRoot, 'selection-project-b');
const projectCPath = path.join(tempRoot, 'selection-project-c');
fs.mkdirSync(projectAPath);
fs.mkdirSync(projectBPath);
fs.mkdirSync(projectCPath);
fs.writeFileSync(repoMapPath, `
version: 1
repos:
  - repoKey: project-a
    github:
      owner: w2030298-art
      repo: project-a
      defaultBranch: main
    linear:
      projectId: linear-project-a
      projectName: Project A
      projectPrefix: project-a
    localPath: ${JSON.stringify(projectAPath)}
    docs:
      - README.md
    evidenceWeight: high
  - repoKey: project-b
    github:
      owner: w2030298-art
      repo: project-b
      defaultBranch: main
    linear:
      projectId: linear-project-b
      projectName: Project B
      projectPrefix: project-b
    localPath: ${JSON.stringify(projectBPath)}
    docs:
      - README.md
    evidenceWeight: high
`);
fs.writeFileSync(localRepoMapPath, `
version: 1
repos:
  - repoKey: project-b
    github:
      owner: w2030298-art
      repo: project-b-local
      defaultBranch: master
    linear:
      projectId: linear-project-b-local
      projectName: Project B Local
      projectPrefix: project-b
    localPath: ${JSON.stringify(projectBPath)}
    docs:
      - README.md
    evidenceWeight: high
  - repoKey: project-c
    github:
      owner: w2030298-art
      repo: project-c
      defaultBranch: main
    linear:
      projectId: linear-project-c
      projectName: Project C
      projectPrefix: project-c
    localPath: ${JSON.stringify(projectCPath)}
    docs:
      - README.md
    evidenceWeight: high
`);

{
  const choices = listRegisteredProjectChoices({ cwd: process.cwd(), repoMapPath, localRepoMapPath });
  assert.deepEqual(choices.map(choice => choice.projectId), ['project-a', 'project-b', 'project-c']);
  assert.equal(choices[0].localPath, path.resolve(projectAPath));
  assert.equal(choices[1].linearProjectId, 'linear-project-b-local');
  assert.equal(choices[1].githubRepo, 'project-b-local');
  assert.equal(choices[2].linearProjectId, 'linear-project-c');
}

{
  const selectCalls: string[][] = [];
  const ctx = {
    hasUI: true,
    ui: {
      async select(_title: string, options: string[]) {
        selectCalls.push(options);
        return 'project-b';
      },
      async input() {
        throw new Error('custom input should not be requested for a repo-map selection');
      },
      notify() {}
    }
  };
  const result = await runProjectSelectionFlow(ctx, { cwd: process.cwd(), repoMapPath, localRepoMapPath });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'project_selected');
  assert.equal(result.source, 'repo_map');
  assert.equal(result.selectedProjectId, 'project-b');
  assert.equal(result.repoKey, 'project-b');
  assert.equal(result.localPath, path.resolve(projectBPath));
  assert.equal(result.linearProjectIdOrKey, 'linear-project-b-local');
  assert.deepEqual(selectCalls[0], ['project-a', 'project-b', 'project-c', CUSTOM_PROJECT_INPUT_LABEL]);
}

{
  const ctx = {
    hasUI: true,
    ui: {
      async select(_title: string, options: string[]) {
        assert.deepEqual(options, ['project-a', 'project-b', 'project-c', CUSTOM_PROJECT_INPUT_LABEL]);
        return CUSTOM_PROJECT_INPUT_LABEL;
      },
      async input(title: string) {
        assert.match(title, /Project ID/i);
        return 'manual-project-id';
      },
      notify() {}
    }
  };
  const result = await runProjectSelectionFlow(ctx, { cwd: process.cwd(), repoMapPath, localRepoMapPath });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'custom_project_input');
  assert.equal(result.source, 'user_input');
  assert.equal(result.selectedProjectId, 'manual-project-id');
  assert.equal(result.repoKey, 'manual-project-id');
  assert.equal(result.writesPerformed, false);
}

{
  const project = findLinearProjectInWorkspace('linear-bridge Linear dispatch bridge', [
    { id: 'project-id-1', name: 'linear-pi-project-admin-agent runtime' },
    { id: 'project-id-2', name: 'linear-bridge Linear dispatch bridge' }
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
  assert.equal(draft.draft.repoKey, 'linear-bridge');
  assert.equal(draft.draft.github.owner, 'w2030298-art');
  assert.equal(draft.draft.github.repo, 'linear-bridge');
  assert.equal(draft.draft.github.defaultBranch, 'main');
  assert.equal(draft.draft.localPath, path.resolve(existingRepo));
  assert.equal(draft.draft.linear.projectId, validAnswers.linearProjectId);
  assert.equal(draft.draft.linear.projectName, validAnswers.linearProject);
  assert.match(draft.yamlPreview, /repoKey: linear-bridge/);
  assert.match(draft.yamlPreview, /owner: w2030298-art/);
  assert.match(draft.yamlPreview, /projectId: project-id-2/);
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
  const fallback = createNonInteractiveRepoMapResult({
    linearProjectId: validAnswers.linearProjectId,
    linearProject: validAnswers.linearProject,
    repoKey: 'linear-bridge'
  });
  assert.equal(fallback.ok, false);
  assert.equal(fallback.status, 'needs_interactive_input');
  assert.equal(fallback.writesPerformed, false);
  assert.match(fallback.evidenceGaps.join('\n'), /Pi UI is not available/i);
  assert.match(fallback.openQuestions.join('\n'), /linear-bridge/);
  assert.match(fallback.openQuestions.join('\n'), /project-id-2/);
}

{
  const asked: string[] = [];
  const answers = [
    validAnswers.linearProject,
    validAnswers.githubUrl,
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
    resolveLinearProject: async () => ({
      ok: true,
      project: { id: validAnswers.linearProjectId, name: validAnswers.linearProject }
    })
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'draft_ready');
  assert.equal(result.draft.repoKey, 'linear-bridge');
  assert.equal(result.draft.linear.projectId, 'project-id-2');
  assert.match(asked[0], /Linear Project/);
  assert.doesNotMatch(asked[0], /GitHub URL/);
  for (const prompt of asked.slice(1)) {
    assert.match(prompt, /Project linear-bridge Linear dispatch bridge/);
    assert.match(prompt, /project-id-2/);
  }
  assert.match(asked[1], /GitHub URL/);
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
  assert.match(result.openQuestions.join('\n'), /Linear Project/);
}

{
  const asked: string[] = [];
  const answers = [
    validAnswers.githubUrl,
    validAnswers.localRepoPath,
    validAnswers.repoKey,
    validAnswers.defaultBranch
  ];
  const ctx = {
    hasUI: true,
    ui: {
      async input(title: string, placeholder?: string) {
        asked.push(`${title} ${placeholder || ''}`);
        return answers.shift();
      },
      notify() {}
    }
  };
  const result = await runRepoMapAskFlow(ctx, {
    cwd: process.cwd(),
    seed: {
      linearProjectId: validAnswers.linearProjectId
    },
    resolveLinearProject: async () => ({
      ok: true,
      project: { id: validAnswers.linearProjectId, name: validAnswers.linearProject }
    })
  });
  assert.equal(result.ok, true);
  assert.equal(result.draft.linear.projectId, validAnswers.linearProjectId);
  assert.equal(asked.length, 4);
  assert.doesNotMatch(asked[0], /^GitHub URL$/);
  assert.match(asked[0], /Project linear-bridge Linear dispatch bridge/);
  assert.match(asked[0], /project-id-2/);
  assert.match(asked[0], /GitHub URL/);
}

{
  const ctx = {
    hasUI: true,
    ui: {
      async input(title: string) {
        assert.match(title, /Project linear-bridge Linear dispatch bridge/);
        assert.match(title, /project-id-2/);
        return undefined;
      },
      notify() {}
    }
  };
  const result = await runRepoMapAskFlow(ctx, {
    cwd: process.cwd(),
    seed: {
      linearProjectId: validAnswers.linearProjectId,
      linearProject: validAnswers.linearProject
    },
    resolveLinearProject: async () => ({
      ok: true,
      project: { id: validAnswers.linearProjectId, name: validAnswers.linearProject }
    })
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'cancelled');
  assert.match(result.openQuestions.join('\n'), /linear-bridge/);
  assert.match(result.openQuestions.join('\n'), /project-id-2/);
  assert.match(result.evidenceGaps.join('\n'), /project-id-2/);
}

{
  const prompts: string[] = [];
  const batch = [
    { id: 'project-a-id', name: 'Project A', repoKey: 'project-a', repo: path.join(tempRoot, 'project-a') },
    { id: 'project-b-id', name: 'Project B', repoKey: 'project-b', repo: path.join(tempRoot, 'project-b') }
  ];
  for (const item of batch) fs.mkdirSync(item.repo);
  for (const item of batch) {
    const answers = [
      `https://github.com/w2030298-art/${item.repoKey}`,
      item.repo,
      item.repoKey,
      'main'
    ];
    const ctx = {
      hasUI: true,
      ui: {
        async input(title: string) {
          prompts.push(title);
          return answers.shift();
        },
        notify() {}
      }
    };
    const result = await runRepoMapAskFlow(ctx, {
      cwd: process.cwd(),
      seed: { linearProjectId: item.id, linearProject: item.name },
      resolveLinearProject: async () => ({ ok: true, project: { id: item.id, name: item.name } })
    });
    assert.equal(result.ok, true);
    assert.equal(result.draft.linear.projectId, item.id);
    assert.equal(result.draft.repoKey, item.repoKey);
  }
  assert.ok(prompts.some(prompt => /Project A/.test(prompt) && /project-a-id/.test(prompt)));
  assert.ok(prompts.some(prompt => /Project B/.test(prompt) && /project-b-id/.test(prompt)));
}

{
  const answers = [
    validAnswers.linearProject,
    validAnswers.githubUrl,
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
    resolveLinearProject: async () => ({
      ok: true,
      project: { id: validAnswers.linearProjectId, name: validAnswers.linearProject }
    })
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'evidence_gap');
  assert.equal(result.writesPerformed, false);
  assert.match(result.evidenceGaps.join('\n'), /local repo path does not exist/i);
  assert.match(result.openQuestions.join('\n'), /linear-bridge/);
}

console.log('pi ask user repo-map tests passed');
