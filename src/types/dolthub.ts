/** DoltHub provisioning types. Sourced from lib/DoltHubProvisioningService.js. */

export interface DoltHubProvisioningResult {
  success: boolean;
  databaseName: string;
  databaseUrl: string;
  remoteUrl?: string;
  owner: string;
  error?: string;
  alreadyExists?: boolean;
  pushCompleted?: boolean;
  pushError?: string;
}

export interface DoltHubDatabase {
  name: string;
  owner: string;
  visibility: 'public' | 'private';
  created_at?: string;
}

export interface DoltHubProvisioningConfig {
  enabled: boolean;
  dryRun: boolean;
  apiUrl: string;
  apiToken?: string;
  owner: string;
  defaultVisibility: 'public' | 'private';
  remoteName: string;
}
