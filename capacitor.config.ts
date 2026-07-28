import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.noqyris.foldwing',
  appName: 'Foldwing',
  webDir: 'dist',
  // Same paper as the canvas, so the letterbox bands above and below the
  // playfield are indistinguishable from the page itself.
  backgroundColor: '#E9EBE4',
  ios: {
    contentInset: 'never',
  },
};

export default config;
