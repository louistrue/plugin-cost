export interface CostItem {
  ebkp: string;
  bezeichnung: string;
  menge: number | null;
  einheit: string;
  kennwert: number | null;
  chf: number | null;
  totalChf: number | null;
  kommentar: string;
  children: CostItem[];
  expanded: boolean;
}

export interface ExcelRow {
  [key: string]: string | number;
}

export type MetaFile = {
  file: File;
  data: CostItem[];
  headers: string[];
  missingHeaders?: string[];
  valid: boolean | null;
};

export interface CostUploaderProps {
  onFileUploaded?: (
    fileName: string,
    date?: string,
    status?: string,
    costData?: CostItem[],
    isUpdate?: boolean
  ) => void;
}

export const REQUIRED_HEADERS = [
  "eBKP",
  "Bezeichnung",
  "Menge",
  "Einheit",
  "Kennwert",
  "CHF",
  "Total CHF",
  "Kommentar",
];

export type ColumnWidthsType = {
  expandIcon: string;
  ebkp: string;
  bezeichnung: string;
  menge: string;
  einheit: string;
  kennwert: string;
  chf: string;
  totalChf: string;
  kommentar: string;
};

export type ColumnHighlightsType = {
  kennwert: string;
  chf: string;
  totalChf: string;
};
