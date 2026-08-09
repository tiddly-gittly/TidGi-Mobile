import { removeLegacyMobileLfAttributesRule } from '../mobileGitSetup';

describe('removeLegacyMobileLfAttributesRule', () => {
  it('removes the legacy rule without changing user-authored LF lines', () => {
    expect(removeLegacyMobileLfAttributesRule(
      '*.png -text\n* text=auto eol=lf\n*.sh text eol=lf\n',
    )).toBe('*.png -text\n*.sh text eol=lf\n');
  });

  it('preserves CRLF and mixed line endings on unrelated rules', () => {
    expect(removeLegacyMobileLfAttributesRule(
      '*.png -text\r\n  * text=auto eol=lf  \r\n*.sh text eol=lf\n*.bat text eol=crlf\r\n',
    )).toBe('*.png -text\r\n*.sh text eol=lf\n*.bat text eol=crlf\r\n');
  });

  it('does not remove repository rules that are not the exact legacy rule', () => {
    const content = '* text=auto\n/docs/** text eol=lf\n';
    expect(removeLegacyMobileLfAttributesRule(content)).toBe(content);
  });

  it('removes a legacy-only file with no trailing newline', () => {
    expect(removeLegacyMobileLfAttributesRule('* text=auto eol=lf')).toBe('');
  });
});
