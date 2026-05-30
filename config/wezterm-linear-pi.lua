local wezterm = require("wezterm")
local act = wezterm.action

local function load_user_config()
  local user_config = wezterm.home_dir .. "\\.wezterm.lua"
  local ok, config = pcall(dofile, user_config)
  if ok and type(config) == "table" then
    return config
  end
  return {}
end

local config = load_user_config()
local keys = config.keys or {}

local managed_keys = {
  { key = "C", mods = "CTRL", action = act.CopyTo("Clipboard") },
  { key = "V", mods = "CTRL", action = act.PasteFrom("Clipboard") },
  { key = "Insert", mods = "CTRL", action = act.CopyTo("Clipboard") },
  { key = "Insert", mods = "SHIFT", action = act.PasteFrom("Clipboard") },
  { key = "P", mods = "CTRL", action = act.ActivateCommandPalette },
  { key = "F2", mods = "NONE", action = act.ActivateCommandPalette },
  { key = "F", mods = "CTRL", action = act.Search({ CaseInSensitiveString = "" }) },
  { key = "T", mods = "CTRL", action = act.SpawnTab("DefaultDomain") },
  { key = "W", mods = "CTRL", action = act.CloseCurrentTab({ confirm = true }) },
}

for _, binding in ipairs(managed_keys) do
  table.insert(keys, binding)
end

config.keys = keys

local runtime_root = os.getenv("LINEAR_PI_RUNTIME_ROOT") or "C:\\Users\\22003\\linear-pi-project-admin-agent-runtime"
config.default_cwd = runtime_root:gsub("\\", "/")

return config
