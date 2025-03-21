import React from "react";
import {
  TableRow,
  TableCell,
  IconButton,
  Collapse,
  Box,
  Table,
  TableBody,
  Tooltip,
  Chip,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import SyncIcon from "@mui/icons-material/Sync";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { CostItem } from "./types";
import { getColumnStyle, columnWidths } from "./styles";
import { tableStyle } from "./styles";
import CostTableChildRow from "./CostTableChildRow.tsx";
import { useKafka } from "../../contexts/KafkaContext";

// Define a proper type for cellStyles instead of using any
interface CellStyles {
  childRow?: React.CSSProperties;
  grandchildRow?: React.CSSProperties;
  menge?: React.CSSProperties;
  standardBorder?: React.CSSProperties;
  kennwert?: React.CSSProperties;
  chf?: React.CSSProperties;
  totalChf?: React.CSSProperties;
  [key: string]: React.CSSProperties | undefined;
}

interface CostTableRowProps {
  item: CostItem;
  expanded: boolean;
  onToggle: (code: string) => void;
  expandedRows: Record<string, boolean>;
  isMobile: boolean;
  cellStyles: CellStyles;
  renderNumber: (
    value: number | null | undefined,
    decimals?: number
  ) => React.ReactElement | string;
}

const CostTableRow = ({
  item,
  expanded,
  onToggle,
  expandedRows,
  isMobile,
  cellStyles,
  renderNumber,
}: CostTableRowProps) => {
  // Function to normalize eBKP codes for matching with Kafka
  const normalizeEbkpCode = (code: string): string => {
    if (!code) return code;

    // Convert code to uppercase for case-insensitive comparison
    const upperCode = code.toUpperCase();

    // Extract letter and number parts, removing leading zeros from numbers
    // Example: "C02.01" becomes "C2.1"
    return upperCode.replace(/([A-Z])0*(\d+)\.0*(\d+)/g, "$1$2.$3");
  };

  // Get the Kafka context
  const {
    replaceEbkpPlaceholders,
    calculateUpdatedChf,
    getAreaData,
    isKafkaData,
    formatTimestamp,
  } = useKafka();

  // Check if this item or any of its children (recursively) have Kafka data
  const hasKafkaDataInTree = (item: CostItem): boolean => {
    // Check if this item has Kafka data
    if (isKafkaData(item.ebkp)) return true;

    // Check children recursively
    if (item.children && item.children.length > 0) {
      for (const child of item.children) {
        if (hasKafkaDataInTree(child)) return true;
      }
    }

    return false;
  };

  // Does this item or any of its children have Kafka data?
  const hasKafkaInTree = hasKafkaDataInTree(item);

  // Process text fields to replace any eBKP placeholders
  const processField = (text: string | null | undefined): string => {
    if (text === null || text === undefined) return "";
    return replaceEbkpPlaceholders(String(text));
  };

  // Get appropriate Menge value - use Kafka area data if available for this eBKP code
  const getMengeValue = (
    ebkpCode: string,
    originalMenge: number | null | undefined
  ) => {
    // If we have area data for this eBKP code (normalize it first)
    if (ebkpCode) {
      const normalizedCode = normalizeEbkpCode(ebkpCode);
      const areaData = getAreaData(normalizedCode);

      if (areaData?.value !== undefined) {
        return areaData.value;
      }
    }
    // Otherwise, use the original value from Excel
    return originalMenge;
  };

  // Get CHF value - calculate based on Kafka area when available
  const getChfValue = () => {
    return calculateUpdatedChf(item);
  };

  // Get info about Kafka data for this eBKP code
  const getKafkaInfo = (ebkpCode: string) => {
    if (!ebkpCode) return null;

    const normalizedCode = normalizeEbkpCode(ebkpCode);
    const areaData = getAreaData(normalizedCode);

    if (!areaData) return null;

    return {
      value: areaData.value,
      timestamp: areaData.timestamp,
      source: areaData.source || "BIM",
    };
  };

  // Create a component for Kafka source info icon with tooltip
  const DataSourceInfo = ({ ebkpCode }: { ebkpCode: string }) => {
    const kafkaInfo = getKafkaInfo(ebkpCode);

    if (!kafkaInfo) return null;

    const formattedTime = formatTimestamp(kafkaInfo.timestamp);

    return (
      <Tooltip
        title={
          <React.Fragment>
            <div>
              <strong>Quelle:</strong> {kafkaInfo.source}
            </div>
            <div>
              <strong>Aktualisiert:</strong> {formattedTime}
            </div>
          </React.Fragment>
        }
        arrow
      >
        <Box
          component="span"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            ml: 0.5,
            cursor: "help",
            color: kafkaInfo.source === "IFC" ? "info.main" : "primary.main",
          }}
        >
          <InfoOutlinedIcon fontSize="small" sx={{ fontSize: "0.875rem" }} />
        </Box>
      </Tooltip>
    );
  };

  return (
    <React.Fragment>
      <TableRow
        hover
        sx={{
          backgroundColor: isKafkaData(item.ebkp)
            ? "rgba(25, 118, 210, 0.04)"
            : hasKafkaInTree
            ? "rgba(25, 118, 210, 0.02)"
            : "rgba(0, 0, 0, 0.04)",
          "& > *": { borderBottom: "unset" },
          borderLeft: isKafkaData(item.ebkp)
            ? "2px solid rgba(25, 118, 210, 0.6)"
            : hasKafkaInTree
            ? "2px solid rgba(25, 118, 210, 0.3)"
            : "none",
        }}
      >
        <TableCell sx={{ padding: isMobile ? "8px 4px" : undefined }}>
          {item.children && item.children.length > 0 && (
            <Tooltip
              title={
                hasKafkaInTree && !expanded
                  ? "BIM Daten in untergeordneten Positionen"
                  : ""
              }
              arrow
              placement="right"
            >
              <IconButton
                aria-label="expand row"
                size="small"
                onClick={() => onToggle(item.ebkp)}
                sx={
                  hasKafkaInTree && !isKafkaData(item.ebkp)
                    ? {
                        color: !expanded ? "info.main" : undefined,
                        opacity: !expanded ? 0.9 : 0.7,
                        border: !expanded
                          ? "1px solid rgba(25, 118, 210, 0.3)"
                          : "none",
                      }
                    : {}
                }
              >
                {expanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
        <TableCell
          component="th"
          scope="row"
          sx={{
            ...getColumnStyle("ebkp"),
            fontWeight: "bold",
            padding: isMobile ? "8px 4px" : undefined,
          }}
        >
          {processField(item.ebkp)}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("bezeichnung"),
            fontWeight: "bold",
            padding: isMobile ? "8px 4px" : undefined,
          }}
        >
          {processField(item.bezeichnung)}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("menge"),
            ...cellStyles.menge,
            position: "relative",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              "& > *:first-of-type": {
                mr: 0.5,
              },
            }}
          >
            {isKafkaData(item.ebkp) && (
              <Chip
                icon={<SyncIcon />}
                size="small"
                label={renderNumber(getMengeValue(item.ebkp, item.menge), 2)}
                variant="outlined"
                color="info"
                sx={{
                  height: 20,
                  "& .MuiChip-label": {
                    px: 0.5,
                    fontSize: "0.75rem",
                  },
                  "& .MuiChip-icon": {
                    fontSize: "0.875rem",
                    ml: 0.5,
                  },
                }}
              />
            )}
            {!isKafkaData(item.ebkp) && hasKafkaInTree && (
              <>
                {renderNumber(getMengeValue(item.ebkp, item.menge), 2)}
                <Tooltip
                  title="Enthält BIM Daten in untergeordneten Positionen"
                  arrow
                >
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      bgcolor: "info.main",
                      display: "inline-block",
                      ml: 0.8,
                      verticalAlign: "middle",
                      opacity: 0.5,
                    }}
                  />
                </Tooltip>
              </>
            )}
            {!isKafkaData(item.ebkp) &&
              !hasKafkaInTree &&
              renderNumber(getMengeValue(item.ebkp, item.menge), 2)}

            {isKafkaData(item.ebkp) && <DataSourceInfo ebkpCode={item.ebkp} />}
          </Box>
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("einheit"),
            ...cellStyles.standardBorder,
          }}
        >
          {isKafkaData(item.ebkp) ? "m²" : processField(item.einheit)}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("kennwert"),
            ...cellStyles.kennwert,
            ...cellStyles.standardBorder,
          }}
        >
          {item.kennwert !== null && item.kennwert !== undefined
            ? renderNumber(item.kennwert)
            : ""}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("chf"),
            ...cellStyles.chf,
            ...cellStyles.standardBorder,
            position: "relative",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center" }}>
            {isKafkaData(item.ebkp) ? (
              <Chip
                size="small"
                label={renderNumber(getChfValue())}
                variant="outlined"
                color="info"
                sx={{
                  height: 20,
                  "& .MuiChip-label": {
                    px: 0.5,
                    fontSize: "0.75rem",
                  },
                }}
              />
            ) : (
              renderNumber(getChfValue())
            )}
          </Box>
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("totalChf"),
            ...cellStyles.totalChf,
            ...cellStyles.standardBorder,
          }}
        >
          {item.totalChf !== null && item.totalChf !== undefined
            ? renderNumber(item.totalChf)
            : ""}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("kommentar"),
            padding: isMobile ? "8px 4px" : undefined,
          }}
        >
          {processField(item.kommentar)}
        </TableCell>
      </TableRow>
      <TableRow key={`${item.ebkp}-children`}>
        <TableCell
          style={{
            padding: 0,
            margin: 0,
            border: 0,
          }}
          colSpan={10}
        >
          <Collapse
            in={expanded}
            timeout="auto"
            unmountOnExit
            sx={{ padding: 0, margin: 0 }}
          >
            <Box sx={{ margin: 0, padding: 0 }}>
              <Table
                size="small"
                aria-label="child items"
                sx={{
                  ...tableStyle,
                  "& td": {
                    padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px",
                  },
                  "& th": {
                    padding: isMobile ? "8px 0 8px 8px" : "16px 0 16px 8px",
                  },
                }}
              >
                <colgroup>
                  <col style={{ width: columnWidths["expandIcon"] }} />
                  <col style={{ width: columnWidths["ebkp"] }} />
                  <col style={{ width: columnWidths["bezeichnung"] }} />
                  <col style={{ width: columnWidths["menge"] }} />
                  <col style={{ width: columnWidths["einheit"] }} />
                  <col style={{ width: columnWidths["kennwert"] }} />
                  <col style={{ width: columnWidths["chf"] }} />
                  <col style={{ width: columnWidths["totalChf"] }} />
                  <col style={{ width: columnWidths["kommentar"] }} />
                </colgroup>
                <TableBody>
                  {item.children?.map((childItem: CostItem) => (
                    <CostTableChildRow
                      key={childItem.ebkp}
                      item={childItem}
                      expanded={expandedRows[childItem.ebkp] || false}
                      onToggle={onToggle}
                      isMobile={isMobile}
                      cellStyles={cellStyles}
                      renderNumber={renderNumber}
                    />
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </React.Fragment>
  );
};

export default CostTableRow;
