import { loadEnv } from 'vite';
import { spawnSync } from 'node:child_process';
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
const value = env.VITE_API_BASE_URL;
if (!value) throw new Error('Set VITE_API_BASE_URL to the shared backend before building the Android app.');
const url = new URL(value);
if (url.protocol !== 'https:' && env.CAPACITOR_ALLOW_CLEARTEXT !== 'true') {
  throw new Error('Use HTTPS for the shared backend. Local LAN testing requires CAPACITOR_ALLOW_CLEARTEXT=true.');
}
for (const [command, args] of [['npm', ['run', 'build']], ['npx', ['cap', 'sync', 'android']]]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Android project synced. Run ./gradlew assembleDebug from frontend/android with an Android SDK and Java installed.');
