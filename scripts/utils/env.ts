import { existsSync } from 'fs';

export async function readEnvFile(path = '.env'): Promise<Record<string, string>> {
  if (!existsSync(path)) return {};
  const text = await Bun.file(path).text();
  const lines = text.split(/\r?\n/);
  const out: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

export function getEnvValue(env: Record<string, string>, key: string, fallback = ''): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}
