export type HomeMode = 'fixture' | 'custom' | 'actual';
export type ProbeState = 'ok' | 'missing' | 'timeout' | 'failed' | 'malformed' | 'restricted' | 'not-run';

export interface ProbeResult {
  state: ProbeState;
  version?: string;
  detail: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  path: string;
  content: string;
  notes: string[];
  status: 'Not shared';
}

export interface Snapshot {
  mode: HomeMode;
  label: string;
  root: string;
  detection: 'Installed' | 'Config found but app not detected' | 'Not found' | 'Version unknown';
  probe: ProbeResult;
  discovery: 'ready' | 'empty' | 'missing' | 'restricted' | 'failed';
  skills: Skill[];
  issues: string[];
}

export interface DesktopApi {
  selectHome(mode: HomeMode): Promise<Snapshot | null>;
}
