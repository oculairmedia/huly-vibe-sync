import path from 'path';

export function getAppRoot() {
  return process.env.VIBESYNC_APP_ROOT || process.cwd();
}

export function resolveFromAppRoot(...segments) {
  return path.join(getAppRoot(), ...segments).replace(/\\/g, '/');
}
