export interface CostItem {
  id?: string;
  name?: string;
  code?: string;
  level?: number | string;
  cost?: number;
  children?: CostItem[];
  ebkp?: string;
  bezeichnung?: string;
  menge?: number;
  einheit?: string;
  kennwert?: number;
  chf?: number;
  totalChf?: number;
  kommentar?: string;
  is_structural?: boolean;
  fire_rating?: string;
  category?: string;
  // Fields for Kafka data tracking
  fromKafka?: boolean;
  kafkaTimestamp?: string;
  kafkaSource?: string;
  areaSource?: string;
  area?: number;
  [key: string]: any;
}

// Types for Kafka cost message
export interface CostDataItem {
  id: string;
  category: string;
  level: string;
  is_structural: boolean;
  fire_rating: string;
  ebkph: string;
  cost: number;
  cost_unit: number;
  area?: number;
  timestamp?: string;
}

export interface CostMessage {
  project: string;
  filename: string;
  timestamp: string;
  data: CostDataItem[];
}

export interface ExcelRow {
  [key: string]: string | number;
}

export type MetaFile = {
  file: File;
  data:
    | CostItem[]
    | {
        project?: string;
        data: CostItem[];
      };
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
