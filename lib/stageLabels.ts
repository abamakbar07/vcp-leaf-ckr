import type { Stage } from './dashboardData';

export const STAGE_LABEL: Record<Stage, string> = {
  OPEN: 'OPEN', GROUPING: 'GROUPING', QC: 'QC DONE', MONITORING: 'MONITORING', READY: 'READY TO LOAD', LOADED: 'LOADED',
};