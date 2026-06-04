// @ts-nocheck
import { clean } from './utils.mjs';

function extractFallbackApprovalText(value) {
  const text = clean(value);
  if (!text) return '';

  const userApproval = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => /^User approval:/i.test(line));
  if (userApproval) return clean(userApproval.replace(/^User approval:\s*/i, ''));

  const unwrapped = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line =>
      line
      && !/^Fallback reason:/i.test(line)
      && !/^Write plan:/i.test(line)
      && !/^Idempotency key:/i.test(line)
      && !/^Confirmation channel:/i.test(line)
    )
    .join('\n');
  return clean(unwrapped) || text;
}

export function detectHostConfirmationCapabilities(env = process.env, cwd = process.cwd()) {
  return {
    askUserAvailable: env.GENERIC_ASK_USER_AVAILABLE === 'true' || env.ASK_USER_AVAILABLE === 'true',
    piAskUserAvailable: env.PI_ASK_USER_AVAILABLE === 'false'
      ? false
      : true,
    conversationFallbackAllowed: env.CONVERSATION_APPROVAL_FALLBACK === 'true' || env.ALLOW_CONVERSATION_APPROVAL_FALLBACK === 'true',
    cwd
  };
}

export function resolveConfirmationChannel({ hostCapabilities = {} } = {}) {
  const askUserAvailable = hostCapabilities.askUserAvailable === true;
  const piAskUserAvailable = hostCapabilities.piAskUserAvailable === true;
  const conversationFallbackAllowed = hostCapabilities.conversationFallbackAllowed === true;

  if (askUserAvailable) {
    return {
      channel: 'ask_user',
      label: 'ask_user approve/cancel',
      canApplyAfterExplicitApproval: true,
      fallbackReason: null,
      userPrompt:
        'Click Approve in the ask_user approve/cancel UI for the exact dry-run write plan; do not type a confirmation phrase.'
    };
  }

  if (conversationFallbackAllowed === true) {
    return {
      channel: 'conversation_fallback',
      label: 'current conversation explicit approval fallback',
      canApplyAfterExplicitApproval: true,
      fallbackReason: piAskUserAvailable
        ? 'Generic ask_user is unavailable; use pi_ask_user(flow=plan_confirmation) for Linear plan confirmation.'
        : 'Generic ask_user is unavailable in this host.',
      userPrompt:
        'Generic ask_user is unavailable; tell the user that one explicit approval in the current conversation will be used as the confirmation source.'
    };
  }

  return {
    channel: 'unavailable',
    label: 'interactive confirmation unavailable; real write not applied',
    canApplyAfterExplicitApproval: false,
    fallbackReason: 'interactive confirmation unavailable; real write not applied. Generic ask_user is unavailable and current-conversation fallback is not explicitly allowed.',
    userPrompt:
      'Real apply is blocked until ask_user approve/cancel is available or the user explicitly allows current-conversation text fallback.'
  };
}

export function buildConfirmationRecord({ channel, confirmationText, confirmationId, writePlanPath, idempotencyKey }) {
  const userApproval = channel.channel === 'conversation_fallback'
    ? extractFallbackApprovalText(confirmationText)
    : clean(confirmationText);
  const id = clean(confirmationId);
  const planPath = clean(writePlanPath) || '(unknown write plan path)';
  const key = clean(idempotencyKey) || '(missing idempotencyKey)';

  if (channel.channel === 'conversation_fallback') {
    return {
      confirmationChannel: 'conversation_fallback',
      confirmationFallbackReason: channel.fallbackReason,
      confirmationId: null,
      confirmationText: [
        `Fallback reason: ${channel.fallbackReason}`,
        `User approval: ${userApproval || '(missing explicit current-conversation approval text)'}`,
        `Write plan: ${planPath}`,
        `Idempotency key: ${key}`
      ].join('\n')
    };
  }

  if (channel.channel === 'ask_user') {
    return {
      confirmationChannel: 'ask_user',
      confirmationFallbackReason: null,
      confirmationId: id || null,
      confirmationText: [
        'Confirmation channel: ask_user approve/cancel UI.',
        'User approval: ask_user approved the exact dry-run write plan.',
        `Write plan: ${planPath}`,
        `Idempotency key: ${key}`
      ].join('\n')
    };
  }

  return {
    confirmationChannel: 'unavailable',
    confirmationFallbackReason: channel.fallbackReason,
    confirmationText: [
      `Confirmation unavailable: ${channel.fallbackReason}`,
      `Write plan: ${planPath}`,
      `Idempotency key: ${key}`
    ].join('\n')
  };
}

function buildConfirmationSelfCheck({ channel, hostCapabilities, dryRun }) {
  const piAskUserAvailable = hostCapabilities.piAskUserAvailable === true;
  const canUseConversationFallback = channel.channel === 'conversation_fallback';
  const canUseDirectAskUser = channel.channel === 'ask_user';
  return {
    phase: dryRun ? 'dry_run' : 'real_apply',
    channel: channel.channel,
    label: channel.label,
    canApproveAfterDryRun: canUseDirectAskUser,
    piAskUserPlanConfirmationAvailable: piAskUserAvailable,
    conversationFallbackAllowed: canUseConversationFallback,
    nextAction: canUseDirectAskUser
      ? 'After dry-run, call pi_ask_user(flow=plan_confirmation) and pass the returned confirmation fields to real apply.'
      : piAskUserAvailable
        ? 'After dry-run, call pi_ask_user(flow=plan_confirmation); dry-run is not user confirmation.'
        : canUseConversationFallback
          ? 'Pi UI approval is unavailable; ask for explicit permission before using conversation_fallback.'
          : 'Real apply is blocked until pi_ask_user(flow=plan_confirmation) is available or the user explicitly allows conversation_fallback.'
  };
}

export function resolveApplyMode({ mode, cliDryRun, cliConfirmed, allow, plan, hostCapabilities, confirmationText, confirmationId, writePlanPath }) {
  const planConfirmed = plan.confirmedByUser === true;
  const confirmed = cliConfirmed || planConfirmed;
  const modeDryRun = mode === 'dry-run';
  const cliConfirmedOverride = cliConfirmed && !cliDryRun && !modeDryRun && allow;
  const planDryRun = plan.dryRun !== false;
  const channel = resolveConfirmationChannel({ hostCapabilities });
  const dryRun = cliDryRun || modeDryRun || !allow || !confirmed || !channel.canApplyAfterExplicitApproval || (planDryRun && !cliConfirmedOverride);
  const baseEffectivePlan = !dryRun && cliConfirmed
    ? { ...plan, dryRun: false, confirmedByUser: true }
    : plan;
  const confirmation = !dryRun
    ? buildConfirmationRecord({
        channel,
        confirmationText: confirmationText || baseEffectivePlan.confirmationText,
        confirmationId: confirmationId || baseEffectivePlan.confirmationId,
        writePlanPath,
        idempotencyKey: baseEffectivePlan.idempotencyKey
      })
    : {};

  return {
    dryRun,
    effectivePlan: !dryRun
      ? { ...baseEffectivePlan, ...confirmation }
      : baseEffectivePlan,
    reason: {
      cliDryRun,
      modeDryRun,
      planDryRun,
      confirmed,
      allow,
      cliConfirmedOverride,
      confirmationChannel: channel
    },
    confirmationSelfCheck: buildConfirmationSelfCheck({ channel, hostCapabilities, dryRun })
  };
}
