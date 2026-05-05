export const LILY_SOURCE_UPDATED_AT = "2026-05-06 01:33 Asia/Shanghai";

export function getLilySourceStamp() {
  const version = chrome.runtime.getManifest().version;
  return `Source updated: ${LILY_SOURCE_UPDATED_AT} · Extension v${version}`;
}
