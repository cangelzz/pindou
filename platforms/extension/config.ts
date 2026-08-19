export const DEFAULT_GITHUB_CLIENT_ID = "Ov23libthPsNlBTIBZHs";

export function getGitHubClientId(override: string | undefined): string {
  return override?.trim() || DEFAULT_GITHUB_CLIENT_ID;
}
