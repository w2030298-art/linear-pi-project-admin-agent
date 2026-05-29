import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "linear_plan_quality_review",
    label: "Linear Plan Quality Review",
    description: "Run deterministic Project Plan / Write Plan checks before Linear writes.",
    parameters: Type.Object({
      planPath: Type.Optional(Type.String()),
      planMarkdownOrJson: Type.Optional(Type.String())
    }),
    promptSnippet: "linear_plan_quality_review: runs schema, label, dependency, fact-boundary, and write-plan checks without mutating Linear.",
    async execute(_id, params, signal) {
      if (params.planPath) {
        const result = await pi.exec("node", ["scripts/plan-reviewer.mjs", params.planPath], { signal, timeout: 60000 });
        return text(result.stdout || result.stderr || { code: result.code });
      }

      const textIn = params.planMarkdownOrJson || "";
      const checks = [
        ["目标", /目标|goal/i],
        ["非目标", /非目标|non-goal/i],
        ["成功指标", /成功指标|success metric/i],
        ["Milestone", /milestone|里程碑/i],
        ["labels", /labels?|标签/i],
        ["Issue 验收标准", /验收标准|acceptance criteria/i],
        ["依赖关系", /依赖|dependency|relation/i],
        ["待确认项", /待确认|open questions?/i],
        ["风险", /风险|risk/i],
        ["回滚", /回滚|rollback/i],
        ["Fact Pack", /fact pack|事实包|事实来源/i],
        ["Dry-run", /dry-run|写入计划|确认/i]
      ].map(([name, re]) => ({ name, pass: (re as RegExp).test(textIn) }));
      const failed = checks.filter(c => !c.pass).map(c => c.name);
      return text({ status: failed.length ? "needs_revision" : "pass", checks, failed });
    }
  });
}
