import assert from "node:assert/strict";
import registerLinearAdminTools from "../.pi/extensions/linear-admin-tools.ts";

type RegisteredTool = {
  name: string;
  description?: string;
  promptGuidelines?: string[];
  execute: (...args: any[]) => Promise<any>;
};

function registerWithExec(exec: (command: string, args: string[]) => Promise<any>) {
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    exec
  };
  registerLinearAdminTools(pi as any);
  return tools;
}

{
  const execCalls: Array<{ command: string; args: string[] }> = [];
  const tools = registerWithExec(async (command, args) => {
    execCalls.push({ command, args });
    if (args[1] === "validate-write-plan") {
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          status: "pass",
          writePlanPath: "state/write-plans/one.json",
          idempotencyKey: "one-key",
          finalValidation: { status: "pass", validationKind: "single_final" },
          nextToolCalls: [
            {
              name: "pi_ask_user",
              params: {
                flow: "plan_confirmation",
                writePlanPath: "state/write-plans/one.json",
                idempotencyKey: "one-key",
                targetProjectSummary: "Project One",
                operationsSummary: "- issue.create: Create issue",
                risksSummary: "No special risk.",
                nonChangesSummary: "No other changes."
              }
            }
          ],
          findings: []
        }),
        stderr: ""
      };
    }
    if (args[1] === "apply") {
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          dryRun: false,
          idempotencyKey: "one-key",
          results: [{ key: "issue", success: true }],
          readbackDiff: { ok: true, mismatches: [] }
        }),
        stderr: ""
      };
    }
    throw new Error(`unexpected exec: ${command} ${args.join(" ")}`);
  });

  const tool = tools.get("linear_validate_and_apply_write_plan");
  assert.ok(tool, "Pi should expose one validate+apply Linear write tool");
  assert.match(tool.description || "", /final validation.*plan_confirmation.*apply/i);
  assert.doesNotMatch((tool.promptGuidelines || []).join("\n"), /run linear_validate_write_plan once, then pi_ask_user/i);

  const result = await tool.execute("call-1", {
    writePlanPath: "state/write-plans/one.json"
  }, undefined, undefined, {
    hasUI: true,
    ui: {
      select: async () => "Yes",
      input: async () => ""
    }
  });

  assert.equal(result.details.ok, true);
  assert.equal(result.details.writesPerformed, true);
  assert.equal(result.details.finalValidation.ok, true);
  assert.equal(result.details.confirmation.status, "approved");
  assert.equal(result.details.apply.ok, true);
  assert.equal(result.details.apply.dryRun, false);
  assert.deepEqual(execCalls.map(call => call.args[1]), ["validate-write-plan", "apply"]);
  const applyArgs = execCalls[1].args;
  assert.ok(applyArgs.includes("--confirmed"));
  assert.ok(applyArgs.includes("--confirmation-channel"));
  assert.ok(applyArgs.includes("ask_user"));
  const confirmationText = applyArgs[applyArgs.indexOf("--confirmation-text") + 1];
  assert.match(confirmationText, /Confirmation channel: pi_ask_user plan_confirmation/);
  assert.match(confirmationText, /Write plan: state\/write-plans\/one\.json/);
  assert.match(confirmationText, /Idempotency key: one-key/);
}

{
  let askedUser = false;
  let applied = false;
  const tools = registerWithExec(async (_command, args) => {
    if (args[1] === "validate-write-plan") {
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: false,
          status: "needs_revision",
          writePlanPath: "state/write-plans/bad.json",
          idempotencyKey: "bad-key",
          findings: [{ code: "write_plan_compile_failed", blocking: true }]
        }),
        stderr: ""
      };
    }
    if (args[1] === "apply") applied = true;
    return { code: 0, stdout: "{}", stderr: "" };
  });

  const tool = tools.get("linear_validate_and_apply_write_plan");
  assert.ok(tool);
  const result = await tool.execute("call-2", {
    writePlanPath: "state/write-plans/bad.json"
  }, undefined, undefined, {
    hasUI: true,
    ui: {
      select: async () => {
        askedUser = true;
        return "Yes";
      }
    }
  });

  assert.equal(result.details.ok, false);
  assert.equal(result.details.status, "needs_revision");
  assert.equal(result.details.writesPerformed, false);
  assert.equal(askedUser, false, "failed final validation must not ask for approval");
  assert.equal(applied, false, "failed final validation must not run apply");
}

console.log("validate and apply tool tests passed");
