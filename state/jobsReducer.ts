import { generateUUID } from '../utils/safeStorage';
import type { RoomType, StagingMode, Tageszeit } from '../services/prompts';

export type ImageType = 'interior' | 'exterior' | 'staging' | 'detail' | 'auto';

export interface ImageJob {
  id: string;
  groupId: string;
  file: File;
  originalUrl: string;
  generatedUrl: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  note?: string;
  tageszeit: Tageszeit;
  imageType: ImageType;
  /** Für die Anzeige pro Kachel. */
  modelLabel?: string;
  costEur?: number;
  cached?: boolean;
  stagingOptions?: { mode: StagingMode; roomType: RoomType };
}

export type JobsAction =
  | { type: 'replace'; jobs: ImageJob[] }
  | { type: 'add'; jobs: ImageJob[] }
  | { type: 'patch'; id: string; patch: Partial<ImageJob> }
  | { type: 'patchMany'; ids: string[]; patch: Partial<ImageJob> }
  | { type: 'reset' };

/**
 * Warum ein Reducer: die Handler hingen alle an [jobs] und wurden bei jedem
 * Statuswechsel neu erzeugt. jobs.find() im Rumpf las dadurch je nach Timing
 * einen veralteten Stand.
 */
export function jobsReducer(state: ImageJob[], action: JobsAction): ImageJob[] {
  switch (action.type) {
    case 'replace': return action.jobs;
    case 'add': return [...state, ...action.jobs];
    case 'patch': return state.map(j => (j.id === action.id ? { ...j, ...action.patch } : j));
    case 'patchMany':
      return state.map(j => (action.ids.includes(j.id) ? { ...j, ...action.patch } : j));
    case 'reset': return [];
    default: return state;
  }
}

export function makeJob(
  base: Pick<ImageJob, 'groupId' | 'file' | 'originalUrl' | 'imageType' | 'tageszeit'> &
    Partial<Pick<ImageJob, 'stagingOptions'>>
): ImageJob {
  return { id: generateUUID(), generatedUrl: null, status: 'pending', ...base };
}

export const hasVariant = (jobs: ImageJob[], groupId: string, tageszeit: Tageszeit): boolean =>
  jobs.some(j => j.groupId === groupId && j.tageszeit === tageszeit);
