# Gist Cloud Sync Feature

**Date:** 2026-04-14
**Status:** Approved

## Context

Users need a way to sync their PindouVerse projects across devices. GitHub Gists provide free, versioned file storage accessible via API. Since the app already has GitHub OAuth (device code flow) for AI voice features, we extend it with `gist` scope to enable cloud project management.

## Naming Convention

Each project is stored as a single-file Gist. The filename follows: `pindouverse__<project-name>.pindou`. The app filters Gists by this prefix to list only PindouVerse projects.

## OAuth Scope Change

Extend the existing GitHub device code flow to request `gist` scope.

- **Tauri (desktop/mobile):** Change scope in `src-tauri/src/commands/github_auth.rs` from `""` to `"gist"`.
- **Browser/VS Code:** Call GitHub's device code endpoint directly from JavaScript with `gist` scope (same OAuth flow, no Rust needed).
- **Re-auth detection:** If existing token lacks `gist` scope, a Gist API call returns 401/403. The app detects this and prompts the user to re-authorize.

## UI — "云端" Button and Dialog

A "云端" button in the top menu bar. Only visible when user is logged in (`hasToken()` returns true).

### Dialog contents

- **Project list** — All Gists matching `pindouverse__*.pindou`. Shows project name (extracted from filename by removing prefix/suffix), last updated time, description.
- **Upload current** — Saves current project to a new or existing Gist. If a Gist with the same project name exists, updates it (PATCH). Otherwise creates new (POST). Prompts for project name if not set.
- **Download** — Loads a Gist project into the editor (replaces current canvas with confirmation if dirty).
- **Delete** — Deletes a Gist with confirmation dialog.
- **Version history** — Each Gist has built-in revision history via commits. Show revisions for a selected project. User can click any revision to restore that version.

## Gist API Wrapper — `src/utils/gistSync.ts`

Platform-agnostic module using `fetch` directly (works on all platforms — Tauri, browser, VS Code, mobile):

```typescript
interface GistProject {
  gistId: string;
  name: string;           // extracted from filename (without prefix/suffix)
  description: string;
  updatedAt: string;
  isPublic: boolean;
}

interface GistRevision {
  sha: string;
  committedAt: string;
}

listProjects(token: string): Promise<GistProject[]>
uploadProject(token: string, name: string, project: ProjectFile, gistId?: string): Promise<string>
downloadProject(token: string, gistId: string): Promise<ProjectFile>
deleteProject(token: string, gistId: string): Promise<void>
listRevisions(token: string, gistId: string): Promise<GistRevision[]>
downloadRevision(token: string, gistId: string, sha: string): Promise<ProjectFile>
```

All Gists are created as **secret** (not public) by default.

### API endpoints used

| Operation | Method | Endpoint |
|-----------|--------|----------|
| List user's gists | GET | `/gists` (paginated, filter client-side by filename) |
| Create gist | POST | `/gists` |
| Update gist | PATCH | `/gists/:id` |
| Get gist | GET | `/gists/:id` |
| Delete gist | DELETE | `/gists/:id` |
| List revisions | GET | `/gists/:id/commits` |
| Get revision | GET | `/gists/:id/:sha` |

## Store Additions

No new Zustand state needed — the dialog manages its own React state (loading, project list, selected project). This keeps the feature isolated.

## Visibility

- "云端" button only renders when `hasToken()` is true (from `src/utils/llmVoice.ts`)
- If user is not logged in, the feature is invisible
- Login is via the existing GitHub device code flow in the toolbar

## Files to modify/create

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/gistSync.ts` | Create | Gist API wrapper (list, upload, download, delete, revisions) |
| `src/App.tsx` | Modify | Add "云端" button and cloud projects dialog |
| `src-tauri/src/commands/github_auth.rs` | Modify | Add `gist` scope to device code request |

## Verification

- Login with GitHub → "云端" button appears
- Upload project → Gist created with `pindouverse__name.pindou` filename
- List projects → shows only PindouVerse gists
- Download project → loads into canvas
- Delete project → Gist removed
- Version history → shows revisions, can restore
- Not logged in → "云端" button hidden
- Token without `gist` scope → re-auth prompted
