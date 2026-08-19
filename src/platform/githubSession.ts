import type { GitHubService, GitHubSession } from "./services";

export interface SubscribableGitHubService extends GitHubService {
  subscribe?(listener: (session: GitHubSession | null) => void): () => void;
}

/** Subscribe before reading so a late initial read cannot overwrite a newer event. */
export function connectGitHubSession(
  service: SubscribableGitHubService,
  onSession: (session: GitHubSession | null) => void,
): () => void {
  let active = true;
  let revision = 0;
  const unsubscribe = service.subscribe?.((session) => {
    revision += 1;
    if (active) onSession(session);
  });
  const initialRevision = revision;
  void service.getSession().then((result) => {
    if (active && revision === initialRevision && result.ok) onSession(result.value);
  });
  return () => { active = false; unsubscribe?.(); };
}
