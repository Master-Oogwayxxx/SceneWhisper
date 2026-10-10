/**
 * Converts HH:MM:SS.mmm timecode format to total seconds.
 * @param timecode - String in format "HH:MM:SS.mmm"
 * @returns Total seconds as a number, or NaN if format is invalid
 */
export function timecodeToSeconds(timecode: string): number {
  const match = timecode.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{2,3})/);
  if (!match) return NaN;
  const [, hours, minutes, seconds, frac] = match;
  const mm = parseInt(minutes);
  const ss = parseInt(seconds);
  if (mm > 59 || ss > 59) return NaN;
  const milliseconds = frac.length === 2 ? parseInt(frac) * 10 : parseInt(frac);
  return parseInt(hours) * 3600 + mm * 60 + ss + milliseconds / 1000;
}

/**
 * Converts total seconds to HH:MM:SS.mmm timecode format.
 * @param totalSeconds - Number of seconds
 * @returns Timecode string in format "HH:MM:SS.mmm". Returns "00:00:00.000" for negative, NaN, or Infinity inputs.
 */
export function secondsToTimecode(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00:00.000';
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(Math.floor(s)).padStart(2, '0');
  const ms = String(Math.round((s % 1) * 1000)).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Validates whether a string is in valid HH:MM:SS.mmm format.
 * @param value - String to validate
 * @returns True if valid timecode format, false otherwise
 */
export function isValidTimecode(value: string): boolean {
  const match = value.match(/^\d{2}:(\d{2}):(\d{2})\.\d{2,3}$/);
  if (!match) return false;
  return parseInt(match[1]) <= 59 && parseInt(match[2]) <= 59;
}

/**
 * Formats user input into HH:MM:SS.mmm timecode format.
 * Strips non-digits and formats as the user types.
 * @param value - Raw user input
 * @returns Formatted timecode string
 */
export function formatTimecode(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  if (digits.length <= 6) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}.${digits.slice(6, 9)}`;
}
