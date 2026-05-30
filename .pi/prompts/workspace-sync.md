# /workspace-sync

目标：同步 workspace manifest。

读取 Linear teams、members、labels、workflow states、projects，与 config/workspace.manifest.json 比较。

输出：
- 新增、删除、重命名、语义不明项。
- 自动吸收项。
- 需要用户确认的映射。
- 更新后的 manifest 草案。

用户输入：
{{input}}
