import { Buffer } from 'buffer';
import { getLogPageWindow, getUtf8PageBytes } from '../../services/LoggerService/logPagination';

describe('log file pagination', () => {
  it('calculates fixed byte windows without reading content', () => {
    expect(getLogPageWindow(0, 0, 20)).toMatchObject({ pageCount: 1, pageIndex: 0, pageStart: 0, pageEnd: 0 });
    expect(getLogPageWindow(41, 1, 20)).toMatchObject({ pageCount: 3, pageIndex: 1, pageStart: 20, pageEnd: 40 });
  });

  it('clamps page indexes', () => {
    expect(getLogPageWindow(41, -10, 20).pageIndex).toBe(0);
    expect(getLogPageWindow(41, 99, 20).pageIndex).toBe(2);
  });

  it('reads only one bounded page plus UTF-8 overlap', () => {
    const window = getLogPageWindow(1_000_000, 10, 32_768);
    expect(window.readLength).toBeLessThanOrEqual(32_768 + 6);
    expect(window.readOffset).toBeGreaterThan(0);
  });

  it('keeps a UTF-8 character crossing a boundary on one page', () => {
    const content = Buffer.from('1234😀5678', 'utf8');
    const firstWindow = getLogPageWindow(content.length, 0, 5);
    const firstRead = content.subarray(firstWindow.readOffset, firstWindow.readOffset + firstWindow.readLength);
    const secondWindow = getLogPageWindow(content.length, 1, 5);
    const secondRead = content.subarray(secondWindow.readOffset, secondWindow.readOffset + secondWindow.readLength);

    const first = Buffer.from(getUtf8PageBytes(firstRead, firstWindow)).toString('utf8');
    const second = Buffer.from(getUtf8PageBytes(secondRead, secondWindow)).toString('utf8');
    expect(first + second).toBe('1234😀56');
    expect(first + second).not.toContain('\uFFFD');
  });

  it('rejects invalid sizes and limits', () => {
    expect(() => getLogPageWindow(-1, 0)).toThrow('non-negative');
    expect(() => getLogPageWindow(1, 0, 0)).toThrow('positive');
  });
});
