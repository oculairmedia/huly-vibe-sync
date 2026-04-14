// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface SyncContext {
  projectIdentifier: string;
  gitRepoPath?: string;
}

export interface SyncActivityResult {
  success: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
  created?: boolean;
  updated?: boolean;
}

// ============================================================
export async function commitBeadsToGit(input: {
  context: SyncContext;
  message?: string;
}): Promise<SyncActivityResult> {
  const { context, message } = input;

  if (!context.gitRepoPath) {
    return { success: true, skipped: true };
  }

  console.log(
    `[Temporal:Git] Skipping legacy tracker commit for ${context.projectIdentifier}; beads integration removed`
  );

  return {
    success: true,
    skipped: true,
    error: message ? `Skipped legacy tracker commit: ${message}` : 'Skipped legacy tracker commit',
  };
}
