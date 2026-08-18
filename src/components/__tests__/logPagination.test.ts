import { paginateLogContent } from '../logPagination';

describe('paginateLogContent', () => {
  it('keeps short and empty logs on one page', () => {
    expect(paginateLogContent('')).toEqual(['']);
    expect(paginateLogContent('one\ntwo', 20)).toEqual(['one\ntwo']);
  });

  it('prefers line boundaries without losing or duplicating content', () => {
    const content = 'first line\nsecond line\nthird line';
    const pages = paginateLogContent(content, 18);
    expect(pages).toEqual(['first line\n', 'second line\n', 'third line']);
    expect(pages.join('')).toBe(content);
  });

  it('splits a single long line and always advances', () => {
    const content = 'x'.repeat(25);
    const pages = paginateLogContent(content, 10);
    expect(pages.map(page => page.length)).toEqual([10, 10, 5]);
    expect(pages.join('')).toBe(content);
  });

  it('does not split a UTF-16 surrogate pair', () => {
    const content = `1234😀5678`;
    const pages = paginateLogContent(content, 5);
    expect(pages.join('')).toBe(content);
    expect(pages[0]).toBe('1234');
  });

  it('rejects an invalid page size', () => {
    expect(() => paginateLogContent('log', 0)).toThrow('greater than zero');
  });
});
