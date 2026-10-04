import { app } from 'electron'

// Dev-only: `--profile=<name>` gives this instance its own userData directory, so a
// second window gets its own single-instance lock, stored token, and guest deviceId.
// Imported first in index.ts so the path is set before electron-store is created.

export const profile = process.argv.find((a) => a.startsWith('--profile='))?.split('=')[1] || null

if (profile) {
  app.setPath('userData', `${app.getPath('userData')}-${profile}`)
}
