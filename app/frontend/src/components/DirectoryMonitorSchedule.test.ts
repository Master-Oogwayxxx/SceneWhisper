import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatSchedule } from './DirectoryMonitorTab';
import { buildBulkSchedulePatch } from './MonitorBulkEditDialog';

describe('directory monitor schedule timezone handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps bulk edit schedule time as local wall-clock time with timezone', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'America/Los_Angeles' }),
    } as Intl.DateTimeFormat);

    expect(buildBulkSchedulePatch('daily', '01:00', 1)).toEqual({
      interval: 'daily',
      time: '01:00',
      dayOfWeek: undefined,
      timeZone: 'America/Los_Angeles',
    });
  });

  it('does not convert timezone-aware schedule times again for display', () => {
    expect(formatSchedule({
      interval: 'daily',
      time: '01:00',
      timeZone: 'America/Los_Angeles',
    })).toBe('Daily at 1:00 AM');
  });
});
