import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.gov.panchmahal.khorak',
  appName: 'KHORAK',
  webDir: 'dist',
  android: {
    allowMixedContent: process.env.CAPACITOR_ALLOW_CLEARTEXT === 'true',
  },
  server: {
    androidScheme: 'https',
    // Explicit opt-in only for local LAN testing; production uses HTTPS.
    cleartext: process.env.CAPACITOR_ALLOW_CLEARTEXT === 'true',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#1B4332',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1B4332',
    },
  },
};

export default config;

