import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.noqyris.foldwing',
  appName: 'Foldwing',
  webDir: 'dist',
  // The night sky's base (Theme ui().sky), the same as the launch screen and
  // index.html's first paint: the web view shows this before the page has
  // painted, and a light colour here is a white flash between two dark frames.
  backgroundColor: '#0F2830',
  ios: {
    contentInset: 'never',
  },
  plugins: {
    /*
     * No banner, sound or badge for a reminder that arrives while the game is
     * open: it would land over a level — often over the very Daily it is
     * about. The default is all four. Set here because the per-notification
     * options live only in the memory of the launch that scheduled them.
     */
    LocalNotifications: {
      presentationOptions: [],
    },
  },
};

export default config;
