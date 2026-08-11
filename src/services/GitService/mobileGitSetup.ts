export const LEGACY_MOBILE_LF_ATTRIBUTES_RULE = '* text=auto eol=lf';

/**
 * Remove the local attributes rule injected by older TidGi Mobile releases.
 *
 * Preserve every other byte, including the file's original line endings.
 * `.git/info/attributes` may contain user-authored rules, so migration must not
 * normalize or reconstruct unrelated lines.
 */
export function removeLegacyMobileLfAttributesRule(content: string): string {
  const linesWithEndings = content.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  return linesWithEndings
    .filter(line => line.replace(/[\r\n]+$/, '').trim() !== LEGACY_MOBILE_LF_ATTRIBUTES_RULE)
    .join('');
}
