import React from "react";
import {
  TableRow,
  TableCell,
  IconButton,
  Collapse,
  Box,
  Table,
  TableBody,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { CostItem } from "./types";
import { getColumnStyle, columnWidths } from "./styles";
import { tableStyle } from "./styles";
import CostTableGrandchildRow from "./CostTableGrandchildRow.tsx";

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

interface CostTableChildRowProps {
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

const CostTableChildRow = ({
  item,
  expanded,
  onToggle,
  isMobile,
  cellStyles,
  renderNumber,
}: Omit<CostTableChildRowProps, "expandedRows">) => {
  return (
    <React.Fragment>
      <TableRow hover sx={cellStyles.childRow}>
        <TableCell sx={{ padding: isMobile ? "8px 4px" : undefined }}>
          {item.children && item.children.length > 0 && (
            <IconButton
              aria-label="expand row"
              size="small"
              onClick={() => onToggle(item.ebkp)}
            >
              {expanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
            </IconButton>
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
          {item.ebkp}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("bezeichnung"),
            padding: isMobile ? "8px 4px" : undefined,
          }}
        >
          {item.bezeichnung}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("menge"),
            ...cellStyles.menge,
          }}
        >
          {item.menge !== null && item.menge !== undefined
            ? renderNumber(item.menge, 0)
            : ""}
        </TableCell>
        <TableCell
          sx={{
            ...getColumnStyle("einheit"),
            ...cellStyles.standardBorder,
          }}
        >
          {item.einheit || ""}
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
          }}
        >
          {item.chf !== null && item.chf !== undefined
            ? renderNumber(item.chf)
            : ""}
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
          {item.kommentar || ""}
        </TableCell>
      </TableRow>

      {/* Third level items (grandchildren) */}
      {item.children && item.children.length > 0 && (
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
                  aria-label="grandchild items"
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
                    {item.children?.map((grandchildItem: CostItem, index) => (
                      <CostTableGrandchildRow
                        key={`${grandchildItem.ebkp}-${index}`}
                        item={grandchildItem}
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
      )}
    </React.Fragment>
  );
};

export default CostTableChildRow;
