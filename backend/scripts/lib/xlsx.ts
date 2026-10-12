// Moved to src/services/master-data/xlsx.ts (shared by the CLI and the web, Part 13).
export {
  readSheet,
  readSheetFromBuffer,
  toCell,
  writeSheet,
  writeSheetToBuffer,
} from '../../src/services/master-data/xlsx.js';
export type {
  Cell,
  ReadSheetResult,
  SheetFailure,
  SheetRow,
  SheetSpec,
} from '../../src/services/master-data/xlsx.js';
