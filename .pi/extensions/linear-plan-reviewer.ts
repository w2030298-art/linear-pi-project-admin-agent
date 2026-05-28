import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "linear_plan_quality_review",
    label: "Linear Plan Quality Review",
    description: "Run a deterministic checklist over a project plan draft before Linear writes.",
    parameters: Type.Object({ planMarkdownOrJson: Type.String() }),
    promptSnippet: "linear_plan_quality_review: checks project plans against planning quality rubric.",
    async execute(_id, params) {
      const textIn = params.planMarkdownOrJson;
      const checks = [
        ["目标", /目标|goal/i],
        ["非目标", /非目标|non-goal/i],
        ["成功指标", /成功指标|success metric/i],
        ["Milestone", /milestone|里程碑/i],
        ["Issue 验收标准", /验收标准|acceptance criteria/i],
        ["依赖关系", /依赖|dependency|relation/i],
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
