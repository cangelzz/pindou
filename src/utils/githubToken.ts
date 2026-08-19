let token: string | null = null;

export function setGitHubToken(value: string): void {
  token = value;
  try { localStorage.setItem("pindouverse_github_token", value); } catch { /* unavailable */ }
}

export function getGitHubToken(): string | null {
  if (token) return token;
  try { token = localStorage.getItem("pindouverse_github_token"); } catch { /* unavailable */ }
  return token;
}

export function clearGitHubToken(): void {
  token = null;
  try { localStorage.removeItem("pindouverse_github_token"); } catch { /* unavailable */ }
}
