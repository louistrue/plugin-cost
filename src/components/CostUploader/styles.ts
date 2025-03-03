import { ColumnWidthsType, ColumnHighlightsType } from "./types";

// Define percentage-based column widths for better consistency
export const columnWidths: ColumnWidthsType = {
  expandIcon: "3.5%",
  ebkp: "8%",
  bezeichnung: "26%",
  menge: "8%",
  einheit: "7.5%",
  kennwert: "11%",
  chf: "11%",
  totalChf: "14%",
  kommentar: "11%",
};

// Define column highlight colors
export const columnHighlights: ColumnHighlightsType = {
  kennwert: "#fff9e6 !important", // Solid light yellow
  chf: "#e6f5e6 !important", // Solid light green
  totalChf: "#e6f5e6 !important", // Solid light green
};

// Create table column styles with consistent widths
export const getColumnStyle = (
  column: keyof typeof columnWidths,
  additionalStyles: object = {}
): Record<string, unknown> => ({
  width: columnWidths[column],
  minWidth: columnWidths[column],
  maxWidth: columnWidths[column],
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  boxSizing: "border-box",
  ...additionalStyles,
});

// Cell styles for alignment and formatting
export const createCellStyles = (
  isMobile: boolean
): Record<string, React.CSSProperties> => ({
  kennwert: {
    backgroundColor: columnHighlights.kennwert,
    textAlign: "right",
    borderRight: "1px dashed #ccc",
    paddingRight: "12px !important", // Normal right padding
  },
  chf: {
    backgroundColor: columnHighlights.chf,
    textAlign: "right",
    borderRight: "1px dashed #ccc",
    paddingRight: "12px !important", // Normal right padding
  },
  totalChf: {
    backgroundColor: columnHighlights.totalChf,
    textAlign: "right",
    fontWeight: "bold",
    paddingRight: "12px !important", // Normal right padding
  },
  menge: {
    textAlign: "right",
    paddingRight: "12px !important", // Normal right padding
  },
  header: {
    backgroundColor: "#f5f5f5",
    fontWeight: "bold",
  },
  childRow: {
    backgroundColor: "#f9f9f9",
    borderLeft: "4px solid #e0e0e0",
  },
  grandchildRow: {
    backgroundColor: "#f0f0f0",
    borderLeft: "8px solid #d5d5d5",
    fontStyle: "italic",
  },
  numeric: {
    textAlign: "right" as const,
    paddingRight: "8px", // Small fixed right padding for right-aligned text
  },
  standardBorder: {
    borderBottom: "1px solid rgba(224, 224, 224, 0.5)",
  },
  cell: {
    padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px", // Left padding only
  },
});

// Table container style
export const createTableContainerStyle = (isMobile: boolean) => ({
  height: "calc(100vh - 350px)",
  mb: 1,
  display: "flex",
  flexDirection: "column",
  overflowX: "auto", // Ensure horizontal scrolling is enabled
  maxWidth: "100%",
  width: "100%",
  "& .MuiTableCell-root": {
    boxSizing: "border-box" as const,
    padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px", // Left padding only
  },
  // Add specific styling for numeric cells
  "& .MuiTableCell-root[align='right']": {
    paddingRight: "12px !important", // Normal right padding for numeric cells
  },
  "& .MuiTable-root": {
    tableLayout: "fixed",
    width: "100%",
    minWidth: "1200px", // Add minimum width to ensure all columns are visible
    borderCollapse: "collapse",
    overflowX: "clip",
  },
  "& .MuiCollapse-root, & .MuiCollapse-wrapper, & .MuiCollapse-wrapperInner": {
    padding: 0,
    margin: 0,
  },
  "& .MuiBox-root": {
    padding: 0,
    margin: 0,
  },
});

// Table style
export const tableStyle = {
  tableLayout: "fixed" as const,
  width: "100%",
  minWidth: "1200px", // Add minimum width to all tables
  borderCollapse: "collapse" as const,
  overflowX: "clip" as const,
  "& .MuiTableCell-alignRight": {
    textAlign: "right",
  },
  "& td": {
    padding: "16px 0 16px 8px",
  },
  "& th": {
    padding: "16px 0 16px 8px",
  },
};

// Dropzone styles
export const getDropzoneStyle = (isDragActive: boolean) => ({
  p: 4,
  mt: 4,
  textAlign: "center",
  cursor: "pointer",
  backgroundColor: isDragActive ? "#f0f7ff" : "#f5f5f5",
  border: "2px dashed #ccc",
  "&:hover": {
    backgroundColor: "#f0f7ff",
    borderColor: "#2196f3",
  },
});
