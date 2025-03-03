import {
  Typography,
  Paper,
  Button,
  Table,
  TableContainer,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  CircularProgress,
  Divider,
  Box,
  Collapse,
  IconButton,
  useMediaQuery,
  useTheme,
  ListItem,
  ListItemIcon,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Delete as DeleteIcon } from "@mui/icons-material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import * as XLSX from "xlsx";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";

interface CostItem {
  code: string;
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  totalPrice?: number;
  children?: CostItem[];
  isParent?: boolean;
  level: number;
}

interface ExcelRow {
  [key: string]: string | number;
}

type MetaFile = {
  file: File;
  data: CostItem[];
  headers: string[];
  valid: boolean | null;
};

interface CostUploaderProps {
  onFileUploaded?: (fileName: string, date?: string, status?: string) => void;
}

const CostUploader = ({ onFileUploaded }: CostUploaderProps) => {
  const [metaFile, setMetaFile] = useState<MetaFile | undefined>();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const toggleRow = (code: string) => {
    setExpandedRows((prev: Record<string, boolean>) => ({
      ...prev,
      [code]: !prev[code],
    }));
  };

  const processExcelData = (jsonData: ExcelRow[]): CostItem[] => {
    const hierarchicalData: CostItem[] = [];
    const parentMap: Record<string, CostItem> = {};

    // First pass: identify parent items and create the structure
    jsonData.forEach((row) => {
      const keys = Object.keys(row);
      if (keys.length < 2) return; // Skip rows with insufficient data

      const firstCol = keys[0] || "";
      const secondCol = keys[1] || "";

      // Check if this is a parent row (like "B Vorbereitung")
      const isParent = typeof row[keys[2]] === "string" && row[keys[2]] === "↓";

      if (isParent) {
        // This is a parent item
        const code = String(row[firstCol] || "");
        const description = String(row[secondCol] || "");
        const totalValue = Number(row[keys[keys.length - 1]] || 0);

        const parentItem: CostItem = {
          code,
          description,
          totalPrice: isNaN(totalValue) ? 0 : totalValue,
          children: [],
          isParent: true,
          level: 0,
        };

        hierarchicalData.push(parentItem);
        parentMap[code] = parentItem;
      } else if (row[firstCol] && String(row[firstCol]).length >= 2) {
        // This is a child item
        const code = String(row[firstCol] || "");
        const description = String(row[secondCol] || "");

        // Extract parent code (e.g., "B" from "B06.01")
        const parentCode = code.split(".")[0];
        if (parentCode.length > 1) {
          // Handle codes like "B06" - extract just the first character
          const mainParentCode = parentCode.charAt(0);

          // Handle potential NaN values by using Number() with fallback to 0
          let quantity = 0;
          let unit = "";
          let unitPrice = 0;
          let totalPrice = 0;

          // Find the quantity, unit, unitPrice and totalPrice columns
          // This handles different Excel formats more robustly
          for (let i = 2; i < keys.length; i++) {
            const value = row[keys[i]];

            // Skip eBKP codes in curly braces like {{eBKP:B06.01}}
            if (typeof value === "string" && value.includes("{{eBKP:")) {
              continue;
            }

            if (i === 2 && value !== undefined && value !== null) {
              quantity = Number(value) || 0;
            } else if (i === 3 && value !== undefined && value !== null) {
              unit = String(value || "");
            } else if (i === 4 && value !== undefined && value !== null) {
              unitPrice = Number(value) || 0;
            } else if (i === 5 && value !== undefined && value !== null) {
              totalPrice = Number(value) || 0;
            }
          }

          const childItem: CostItem = {
            code,
            description,
            quantity: isNaN(quantity) ? 0 : quantity,
            unit,
            unitPrice: isNaN(unitPrice) ? 0 : unitPrice,
            totalPrice: isNaN(totalPrice) ? 0 : totalPrice,
            level: 1,
          };

          // Add to parent if exists
          if (parentMap[mainParentCode]) {
            parentMap[mainParentCode].children?.push(childItem);
          } else {
            // If parent doesn't exist yet, create it
            const parentItem: CostItem = {
              code: mainParentCode,
              description: `${mainParentCode} Group`,
              children: [childItem],
              isParent: true,
              level: 0,
            };
            hierarchicalData.push(parentItem);
            parentMap[mainParentCode] = parentItem;
          }
        }
      }
    });

    return hierarchicalData;
  };

  const onDropFile = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    setIsLoading(true);

    try {
      const file = acceptedFiles[0];
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: "binary" });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet) as ExcelRow[];

          // Process the data to create a hierarchical structure
          const processedData = processExcelData(jsonData);

          // Extract headers
          const headers = Object.keys(jsonData[0] || {});

          setMetaFile({
            file: file,
            data: processedData,
            headers: headers,
            valid: jsonData.length > 0,
          });

          setIsLoading(false);
        } catch (error) {
          console.error("Error parsing Excel file:", error);
          setIsLoading(false);
        }
      };

      reader.onerror = () => {
        console.error("Error reading file");
        setIsLoading(false);
      };

      reader.readAsBinaryString(file);
    } catch (error) {
      console.error("Error processing file:", error);
      setIsLoading(false);
    }
  }, []);

  const fileSize = (size: number) => {
    if (size === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(size) / Math.log(k));
    return parseFloat((size / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleRemoveFile = () => {
    setMetaFile(undefined);
  };

  const handleSendData = async () => {
    if (!metaFile) return;

    // Here you would implement the API call to send the data
    // For now, we'll just simulate a successful upload
    setIsLoading(true);

    // Simulate API call
    setTimeout(() => {
      const fileName = metaFile.file.name;
      const currentDate = new Date().toLocaleString("de-CH");
      const status = "Erfolgreich";

      // Call the onFileUploaded prop if provided
      if (onFileUploaded) {
        onFileUploaded(fileName, currentDate, status);
      }

      setMetaFile(undefined);
      setIsLoading(false);
    }, 1500);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropFile,
    multiple: false,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx",
      ],
      "application/vnd.ms-excel": [".xls"],
    },
  });

  const renderHierarchicalTable = () => {
    if (!metaFile?.data) return null;

    return (
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{
          height: "calc(100vh - 350px)",
          mb: 1,
          display: "flex",
          flexDirection: "column",
          overflowX: "auto",
        }}
      >
        <Table stickyHeader size="small" sx={{ flexGrow: 1 }}>
          <TableHead>
            <TableRow sx={{ backgroundColor: "background.paper" }}>
              <TableCell
                sx={{
                  width: "40px",
                  padding: isMobile ? "8px 4px" : undefined,
                }}
              ></TableCell>
              <TableCell
                sx={{
                  fontWeight: "bold",
                  width: "80px",
                  padding: isMobile ? "8px 4px" : undefined,
                }}
              >
                Code
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: "bold",
                  width: "auto",
                  padding: isMobile ? "8px 4px" : undefined,
                }}
              >
                Beschreibung
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: "bold",
                  width: "80px",
                  padding: isMobile ? "8px 4px" : undefined,
                }}
              >
                Menge
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: "bold",
                  width: "80px",
                  padding: isMobile ? "8px 4px" : undefined,
                }}
              >
                Einheit
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: "bold",
                  width: "100px",
                  padding: isMobile ? "8px 4px" : undefined,
                }}
              >
                Einheitspreis
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: "bold",
                  width: "100px",
                  padding: isMobile ? "8px 4px" : undefined,
                }}
              >
                Gesamtpreis
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {metaFile.data.map((parentItem: CostItem) => (
              <>
                <TableRow
                  key={parentItem.code}
                  hover
                  sx={{
                    backgroundColor: "rgba(0, 0, 0, 0.04)",
                    "& > *": { borderBottom: "unset" },
                  }}
                >
                  <TableCell sx={{ padding: isMobile ? "8px 4px" : undefined }}>
                    {parentItem.children && parentItem.children.length > 0 && (
                      <IconButton
                        aria-label="expand row"
                        size="small"
                        onClick={() => toggleRow(parentItem.code)}
                      >
                        {expandedRows[parentItem.code] ? (
                          <KeyboardArrowUpIcon />
                        ) : (
                          <KeyboardArrowDownIcon />
                        )}
                      </IconButton>
                    )}
                  </TableCell>
                  <TableCell
                    component="th"
                    scope="row"
                    sx={{
                      fontWeight: "bold",
                      padding: isMobile ? "8px 4px" : undefined,
                    }}
                  >
                    {parentItem.code}
                  </TableCell>
                  <TableCell
                    sx={{
                      fontWeight: "bold",
                      padding: isMobile ? "8px 4px" : undefined,
                    }}
                  >
                    {parentItem.description}
                  </TableCell>
                  <TableCell
                    sx={{
                      padding: isMobile ? "8px 4px" : undefined,
                    }}
                  ></TableCell>
                  <TableCell
                    sx={{
                      padding: isMobile ? "8px 4px" : undefined,
                    }}
                  ></TableCell>
                  <TableCell
                    sx={{
                      padding: isMobile ? "8px 4px" : undefined,
                    }}
                  ></TableCell>
                  <TableCell
                    sx={{
                      fontWeight: "bold",
                      padding: isMobile ? "8px 4px" : undefined,
                    }}
                  >
                    {typeof parentItem.totalPrice === "number" &&
                    !isNaN(parentItem.totalPrice)
                      ? parentItem.totalPrice.toLocaleString("de-CH", {
                          minimumFractionDigits: 2,
                        })
                      : ""}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell
                    style={{ paddingBottom: 0, paddingTop: 0 }}
                    colSpan={7}
                  >
                    <Collapse
                      in={expandedRows[parentItem.code]}
                      timeout="auto"
                      unmountOnExit
                    >
                      <Box sx={{ margin: 1 }}>
                        <Table size="small" aria-label="child items">
                          <TableBody>
                            {parentItem.children?.map((childItem: CostItem) => (
                              <TableRow key={childItem.code} hover>
                                <TableCell
                                  sx={{
                                    padding: isMobile ? "8px 4px" : undefined,
                                  }}
                                ></TableCell>
                                <TableCell
                                  sx={{
                                    padding: isMobile ? "8px 4px" : undefined,
                                  }}
                                >
                                  {childItem.code}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    padding: isMobile ? "8px 4px" : undefined,
                                  }}
                                >
                                  {childItem.description}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    padding: isMobile ? "8px 4px" : undefined,
                                  }}
                                >
                                  {typeof childItem.quantity === "number" &&
                                  !isNaN(childItem.quantity)
                                    ? childItem.quantity.toLocaleString("de-CH")
                                    : ""}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    padding: isMobile ? "8px 4px" : undefined,
                                  }}
                                >
                                  {childItem.unit || ""}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    padding: isMobile ? "8px 4px" : undefined,
                                  }}
                                >
                                  {typeof childItem.unitPrice === "number" &&
                                  !isNaN(childItem.unitPrice)
                                    ? childItem.unitPrice.toLocaleString(
                                        "de-CH",
                                        { minimumFractionDigits: 2 }
                                      )
                                    : ""}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    padding: isMobile ? "8px 4px" : undefined,
                                  }}
                                >
                                  {typeof childItem.totalPrice === "number" &&
                                  !isNaN(childItem.totalPrice)
                                    ? childItem.totalPrice.toLocaleString(
                                        "de-CH",
                                        { minimumFractionDigits: 2 }
                                      )
                                    : ""}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {!metaFile ? (
        <Paper
          {...getRootProps()}
          sx={{
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
          }}
        >
          <input {...getInputProps()} />
          {isDragActive ? (
            <>
              <UploadFileIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body1" color="primary">
                Lassen Sie die Excel-Datei hier fallen...
              </Typography>
            </>
          ) : (
            <>
              <UploadFileIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body1" color="textPrimary">
                Drag and Drop
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Format: Excel (.xlsx, .xls)
              </Typography>
            </>
          )}
        </Paper>
      ) : (
        <>
          {isLoading ? (
            <Box display="flex" justifyContent="center" my={4}>
              <CircularProgress />
            </Box>
          ) : (
            <div className="flex flex-col h-full">
              <ListItem sx={{ mt: 4 }}>
                <ListItemIcon>
                  <InsertDriveFileIcon color="primary" />
                </ListItemIcon>
                <div className="flex-grow">
                  <Typography sx={{ color: "#666" }}>
                    {metaFile.file.name}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: "#888" }}
                    className="pb-2"
                  >
                    {fileSize(metaFile.file.size || 0)}
                  </Typography>
                </div>
                <ListItemIcon className="flex gap-6">
                  <IconButton edge="end" onClick={handleRemoveFile}>
                    <DeleteIcon />
                  </IconButton>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleSendData}
                    disabled={!metaFile.valid}
                  >
                    Daten senden
                  </Button>
                </ListItemIcon>
              </ListItem>

              <Divider sx={{ my: 2 }} />

              <Typography variant="h6" className="mb-2">
                Kostenübersicht
              </Typography>

              {renderHierarchicalTable()}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CostUploader;
