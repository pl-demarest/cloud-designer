/**
 * How long a download's object URL stays valid after the click. Firefox and Safari can read the
 * URL after click() returns, so revoking it at once can cancel the download.
 */
export const REVOKE_DELAY_MS = 40_000;

/** Saves `blob` as `filename` through a temporary link; the object URL is revoked later. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  // In the document: Firefox ignores click() on a detached link.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** The longest stem safeFileName returns. */
const MAX_STEM = 80;

/**
 * A file-name stem from a preset name: lower case, accents dropped, each run of characters
 * other than a-z, 0-9, '-' and '_' replaced by one '-', no '-' at either end, at most 80
 * characters; 'cloud' when nothing is left. 'Default Cloud' gives 'default-cloud'.
 */
export function safeFileName(name: string): string {
  const stem = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_STEM)
    .replace(/^-+|-+$/g, '');
  return stem || 'cloud';
}
