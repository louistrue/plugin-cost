import React from "react";
import { TableRow, TableCell, Box, Tooltip, Chip } from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { CostItem } from "./types";
import { getColumnStyle } from "./styles";
import { useKafka } from "../../contexts/KafkaContext";

// Define a proper type for cellStyles instead of using any
interface CellStyles {
  grandchildRow?: React.CSSProperties;
  menge?: React.CSSProperties;
  standardBorder?: React.CSSProperties;
  kennwert?: React.CSSProperties;
  chf?: React.CSSProperties;
  totalChf?: React.CSSProperties;
  [key: string]: React.CSSProperties | undefined;
}

interface CostTableGrandchildRowProps {
  item: CostItem;
  isMobile: boolean;
  cellStyles: CellStyles;
  renderNumber: (
    value: number | null | undefined,
    decimals?: number
  ) => React.ReactElement | string;
}

const CostTableGrandchildRow = ({
  item,
  isMobile,
  cellStyles,
  renderNumber,
}: CostTableGrandchildRowProps) => {
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

  // Check if this item has Kafka data (either from flag or service)
  const hasKafkaData = (item: CostItem): boolean => {
    return item.fromKafka === true || (item.ebkp && isKafkaData(item.ebkp));
  };

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
    // Check if item has a fromKafka flag (indicating it was updated with Kafka data)
    if (item.fromKafka) {
      return item.menge;
    }

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
    // If item has a fromKafka flag, calculate cost based on the item's menge
    if (
      item.fromKafka &&
      item.menge !== undefined &&
      item.kennwert !== undefined
    ) {
      return item.menge * item.kennwert;
    }

    return calculateUpdatedChf(item);
  };

  // Get info about Kafka data for this eBKP code
  const getKafkaInfo = (ebkpCode: string) => {
    // If the item has FromKafka flag, use its data
    if (item.fromKafka) {
      return {
        value: item.menge,
        timestamp: item.kafkaTimestamp || new Date().toISOString(),
        source: item.kafkaSource || "BIM",
      };
    }

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
    <TableRow
      hover
      sx={{
        ...cellStyles.grandchildRow,
        backgroundColor: hasKafkaData(item)
          ? "rgba(25, 118, 210, 0.02)"
          : undefined,
        borderLeft: hasKafkaData(item)
          ? "2px solid rgba(25, 118, 210, 0.3)"
          : "none",
      }}
    >
      <TableCell sx={{ padding: isMobile ? "8px 4px" : undefined }}>
        {hasKafkaData(item) && (
          <Box
            sx={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              bgcolor: "info.main",
              display: "inline-block",
              ml: 0.5,
              verticalAlign: "middle",
              opacity: 0.7,
            }}
          />
        )}
      </TableCell>
      <TableCell
        component="th"
        scope="row"
        sx={{
          ...getColumnStyle("ebkp"),
          padding: isMobile ? "8px 4px" : undefined,
        }}
      >
        {processField(item.ebkp)}
      </TableCell>
      <TableCell
        sx={{
          ...getColumnStyle("bezeichnung"),
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
          {hasKafkaData(item) && (
            <Chip
              icon={<SyncIcon />}
              size="small"
              label={renderNumber(
                getMengeValue(item.ebkp ?? "", item.menge),
                2
              )}
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
          {!hasKafkaData(item) &&
            renderNumber(getMengeValue(item.ebkp ?? "", item.menge), 2)}

          {hasKafkaData(item) && <DataSourceInfo ebkpCode={item.ebkp ?? ""} />}
        </Box>
      </TableCell>
      <TableCell
        sx={{
          ...getColumnStyle("einheit"),
          ...cellStyles.standardBorder,
        }}
      >
        {hasKafkaData(item) ? "m²" : processField(item.einheit)}
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
          {hasKafkaData(item) ? (
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
  );
};

export default CostTableGrandchildRow;
