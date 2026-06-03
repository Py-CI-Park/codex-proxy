export const APPCAST_URL = "https://persistent.oaistatic.com/codex-app-prod/appcast.xml";

export interface UpdateState {
  last_check: string;
  latest_version: string | null;
  latest_build: string | null;
  download_url: string | null;
  update_available: boolean;
  current_version: string;
  current_build: string;
}

export interface AppcastInfo {
  version: string | null;
  build: string | null;
  downloadUrl: string | null;
}

export function parseAppcast(xml: string): AppcastInfo {
  const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/i);
  if (!itemMatch) return { version: null, build: null, downloadUrl: null };
  const item = itemMatch[1];
  const versionMatch =
    item.match(/sparkle:shortVersionString="([^"]+)"/) ??
    item.match(/<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/);
  const buildMatch =
    item.match(/sparkle:version="([^"]+)"/) ??
    item.match(/<sparkle:version>([^<]+)<\/sparkle:version>/);
  const urlMatch = item.match(/url="([^"]+)"/);
  return {
    version: versionMatch?.[1] ?? null,
    build: buildMatch?.[1] ?? null,
    downloadUrl: urlMatch?.[1] ?? null,
  };
}
