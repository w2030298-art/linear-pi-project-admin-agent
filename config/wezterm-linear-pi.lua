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
local keys = {}

local function normalize_mods(mods)
  if mods == nil or mods == "" then
    return "NONE"
  end
  local parts = {}
  for part in string.gmatch(mods, "[^|]+") do
    table.insert(parts, part)
  end
  table.sort(parts)
  return table.concat(parts, "|")
end

local managed_key_ids = {
  ["CTRL:c"] = true,
  ["CTRL:C"] = true,
  ["CTRL:v"] = true,
  ["CTRL:V"] = true,
  ["CTRL:insert"] = true,
  ["SHIFT:insert"] = true,
  ["CTRL:f"] = true,
  ["CTRL:F"] = true,
  ["CTRL:p"] = true,
  ["CTRL:P"] = true,
  ["CTRL:t"] = true,
  ["CTRL:T"] = true,
  ["CTRL:w"] = true,
  ["CTRL:W"] = true,
  ["NONE:f2"] = true,
}

local function key_id(binding)
  return normalize_mods(binding.mods) .. ":" .. (binding.key or "")
end

if type(config.keys) == "table" then
  for _, binding in ipairs(config.keys) do
    if not managed_key_ids[key_id(binding)] then
      table.insert(keys, binding)
    end
  end
end

local function copy_or_interrupt(window, pane)
  local has_selection = window:get_selection_text_for_pane(pane) ~= ""
  if has_selection then
    window:perform_action(act.CopyTo("Clipboard"), pane)
    window:perform_action(act.ClearSelection, pane)
  else
    window:perform_action(act.SendKey({ key = "c", mods = "CTRL" }), pane)
  end
end

local managed_keys = {
  { key = "c", mods = "CTRL", action = wezterm.action_callback(copy_or_interrupt) },
  { key = "C", mods = "CTRL", action = act.CopyTo("Clipboard") },
  { key = "v", mods = "CTRL", action = act.PasteFrom("Clipboard") },
  { key = "V", mods = "CTRL", action = act.PasteFrom("Clipboard") },
  { key = "Insert", mods = "CTRL", action = act.CopyTo("Clipboard") },
  { key = "Insert", mods = "SHIFT", action = act.PasteFrom("Clipboard") },
  { key = "p", mods = "CTRL", action = act.ActivateCommandPalette },
  { key = "P", mods = "CTRL", action = act.ActivateCommandPalette },
  { key = "F2", mods = "NONE", action = act.ActivateCommandPalette },
  { key = "f", mods = "CTRL", action = act.Search({ CaseInSensitiveString = "" }) },
  { key = "F", mods = "CTRL", action = act.Search({ CaseInSensitiveString = "" }) },
  { key = "t", mods = "CTRL", action = act.SpawnTab("DefaultDomain") },
  { key = "T", mods = "CTRL", action = act.SpawnTab("DefaultDomain") },
  { key = "w", mods = "CTRL", action = act.CloseCurrentTab({ confirm = true }) },
  { key = "W", mods = "CTRL", action = act.CloseCurrentTab({ confirm = true }) },
}

for _, binding in ipairs(managed_keys) do
  table.insert(keys, binding)
end

config.keys = keys

local runtime_root = os.getenv("LINEAR_PI_RUNTIME_ROOT") or "C:\\Users\\22003\\linear-pi-project-admin-agent-runtime"
config.default_cwd = runtime_root:gsub("\\", "/")

return config
