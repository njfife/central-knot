// Shared cross-platform test helpers and Windows-only skip reasons (each naming the Windows plan step that lifts it).
import { sep } from 'node:path';

/**
 * Turns only the host platform's native path separator into `/`.
 * On macOS and Linux `sep` is `/`, so this is a no-op and never rewrites a `\` character inside a filename.
 */
export const slashPath = (path: string): string => (sep === '/' ? path : path.replaceAll(sep, '/'));

/** Skip reason on Windows for POSIX execute/group permission-bit assertions (WINDOWS-PLAN.md step 19 under Later). */
export const posixModeSkip: string | false = process.platform === 'win32'
  && 'Windows NTFS has no POSIX execute/group mode bits (chmod 0755 stays 0666; exec bits on Windows are step 19 under Later); covered on macOS and Linux.';

/** Skip reason on Windows for colon-in-folder-name tests (WINDOWS-PLAN.md step 5 refuses unwriteable Windows names). */
export const colonNameSkip: string | false = process.platform === 'win32'
  && 'Windows NTFS forbids colons in folder names (step 5 adds app refusal for unwriteable Windows names; POSIX colon-name round-trips stay covered on macOS and Linux).';
