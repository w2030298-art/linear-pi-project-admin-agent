export function parseGitHubUrl(value: string): { ok: true; owner: string; repo: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) return { ok: true, owner: sshMatch[1], repo: sshMatch[2] };

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (host !== "github.com" || parts.length < 2) {
      return { ok: false, error: "GitHub URL must point to github.com/<owner>/<repo>." };
    }
    return { ok: true, owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
  } catch {
    return { ok: false, error: "GitHub URL is not a valid URL." };
  }
}
