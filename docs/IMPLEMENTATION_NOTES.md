# 实现说明

## Pi extension

本项目使用 Pi `pi.registerTool()` 暴露专用工具。工具主体尽量转发给 `scripts/*.mjs`，这样方便测试和在 webhook bridge 中复用。

## Linear apply

`linear-cli.mjs apply` 默认不真实写入。你需要在确认 schema 和策略后实现：

- projectCreate / projectUpdate。
- projectMilestoneCreate。
- issueCreate / issueUpdate。
- issueRelationCreate。
- projectUpdateCreate。
- commentCreate。

每个 mutation 后必须 readback。

## MCP

`config/mcp.servers.json` 提供 GitHub MCP Server 配置。由于不同 MCP host 的配置语法可能不同，本项目保留 REST fallback，确保 GitHub 事实来源可用。

## Web search

支持 Tavily 和 Brave 两种 provider。默认 Tavily，因为返回内容更适合 Fact Pack；Brave 可作为隐私和独立索引优先的替代。
