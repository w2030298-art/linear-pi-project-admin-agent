# Pipeline Refactor Audit | 2026-05-30

## Scope

This audit covers the large pipeline refactor for Linear Project Admin Runtime:

- reduce context pressure from pipeline prompts and skills;
- keep Fact Pack understanding while moving raw evidence out of prompt context;
- process at most one Linear Project per run;
- remove active cycle facts and workspace-wide project planning flows;
- simplify Linear write confirmation to one final approval state;
- fix ask_user half-confirmed write guard behavior;
- fix WezTerm runtime shortcut startup when runtime state is locally dirty.

## Reproduced Friction

1. Fact Pack embedded large raw Linear/GitHub/local payload snippets into facts. This made downstream prompts carry evidence and summary at the same time.
2. `/portfolio-review` and the old snapshot script encouraged scanning all active Projects and generating broad state files.
3. Cycle removal was implemented as a disabled-capability declaration, so prompts, skills, tests, and write-plan messages still carried cycle noise.
4. `linearWriteGuardDecision()` allowed a real write when `confirmationChannel=ask_user` but the final user-confirmed state had not been produced yet.
5. The installed WezTerm launcher refused to start when the runtime checkout had only generated local state changes, reproducing the flash-close path:
   `M state/portfolio-review/portfolio-snapshot-2026-05-28.json`.

## Changes Made

1. Added compact Fact Digest + Evidence Store:
   - facts now carry `summary` and `evidenceRef`;
   - raw evidence is written under `state/fact-packs/evidence/<fact-id>/`;
   - generated evidence is ignored by git.
2. Reworked review/planning flow to one Project at a time:
   - `/portfolio-review` now requires a selected Project before detailed review;
   - workspace-level Project listing is only a candidate-selection step;
   - old workspace-wide portfolio snapshot builder and generated JSON state were removed.
3. Removed active cycle pipeline surfaces:
   - deleted active cycle prompt and skill;
   - removed cycle data from Linear workspace/project snapshots;
   - removed cycle fields from issue create/update field lists;
   - left only a low-level unsupported-field guard for incoming `cycleId` write-plan input.
4. Simplified Linear write safety:
   - real writes now require the final approval state from `prepareWriteConfirmation`;
   - ask_user partial confirmation blocks instead of falling through.
5. Hardened trigger routing:
   - unknown `Agent:*` labels no longer enqueue a generic task;
   - unsupported labels return a clear non-queued result.
6. Fixed WezTerm startup:
   - launcher allows ignored/generated runtime state changes and skips `git pull` in that case;
   - code/config dirty changes still block startup;
   - installed launcher was refreshed under `%LOCALAPPDATA%\LinearProjectAdminPi`.

## Verification

Passed:

- `npm run test:pipeline-refactor-goals`
- `npm run test:unsupported-fields`
- `npm run test:write-confirmation`
- `npm run test:plan-review`
- `npm run test:runtime-instruction-boundary`
- `npm run test:runtime-local-protection`
- `npm run test:linear-snapshot`
- `npm run validate`
- `npx tsc --noEmit`
- `npm run test:pi-ask-user`
- `npm run test:wezterm-launch`
- `npm run test:linear-apply-mode`
- `npm run test:runtime-reload-master`
- `npm run test:retrieval-ux`
- `npm run test:webhook-signature`
- `npm run test:project-description-fields`
- `npm run test:repo-map`
- `npm run test:repo-map-drift`
- `npm run fact:local`
- `npm run linear:smoke`
- `npm run linear:workspace`
- `npm run fact:pack -- --task "pipeline refactor single project smoke" --linear c642b249-cdda-4e85-b7f4-604776cb8cbd`
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\install-wezterm-linear-pi-shortcut.ps1 -SkipRuntimeInit`
- `& "$env:LOCALAPPDATA\LinearProjectAdminPi\launch-linear-pi-runtime.ps1" -PrepareOnly`
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\install-wezterm-linear-pi-shortcut.ps1 -SkipRuntimeInit -SelfTestAllowedRuntimeDirty`

Key observed outputs:

- Fact Pack smoke produced compact facts with `evidenceRef`, including Linear summary `issues=22; milestones=6; updates=5`.
- `linear:workspace` returned projects and workflow states without cycles.
- Installed launcher `-PrepareOnly` returned `exit=0` while runtime had only allowed generated state dirty.
- Launcher self-test returned `ignoredRuntimeDirtyAllowed=true` and `codeDirtyAllowed=false`.

## Remaining Non-Blocking Notes

- The working tree still contains pre-existing untracked `NUL`; this audit did not delete unrelated files.
- Runtime historical audit logs still contain older Linear text. They are ignored local state and are not active prompts, skills, docs, or source.
