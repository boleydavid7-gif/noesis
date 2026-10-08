import type { CapacitorConfig } from '@capacitor/cli'

// The phone apps carry the built web app (the dist folder) and talk to the live server for search,
// Noema and sync. See docs/app-stores.md for the steps to build and publish them.
const config: CapacitorConfig = {
  appId: 'com.proairetos.noesis',
  appName: 'Noesis',
  webDir: 'dist',
  backgroundColor: '#06101d',
  ios: { contentInset: 'always' },
}

export default config
