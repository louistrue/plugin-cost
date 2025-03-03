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
  Alert,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Delete as DeleteIcon } from "@mui/icons-material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import * as XLSX from "xlsx";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ArrowRightAltIcon from "@mui/icons-material/ArrowRightAlt";

interface CostItem {
  code: string;
  description: string;
  quantity?: number | null;
  unit?: string;
  kennwert?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
  kommentar?: string;
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
  missingHeaders?: string[];
  valid: boolean | null;
};

interface CostUploaderProps {
  onFileUploaded?: (fileName: string, date?: string, status?: string) => void;
}

const REQUIRED_HEADERS = [
  "eBKP",
  "Bezeichnung",
  "Menge",
  "Einheit",
  "Kennwert",
  "CHF",
  "Total CHF",
  "Kommentar",
];

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

  const processExcelData = (
    jsonData: ExcelRow[],
    headers: string[]
  ): CostItem[] => {
    const hierarchicalData: CostItem[] = [];
    const parentMap: { [key: string]: CostItem } = {};

    // Find column indexes
    const ebkpIndex = headers.findIndex(
      (h) => h === "eBKP" || h.includes("eBKP")
    );
    const bezeichnungIndex = headers.findIndex(
      (h) => h === "Bezeichnung" || h.includes("Bezeichnung")
    );
    const mengeIndex = headers.findIndex(
      (h) => h === "Menge" || h.includes("Menge")
    );
    const einheitIndex = headers.findIndex(
      (h) => h === "Einheit" || h.includes("Einheit")
    );
    const kennwertIndex = headers.findIndex(
      (h) => h === "Kennwert" || h.includes("Kennwert")
    );
    const chfIndex = headers.findIndex(
      (h) => h === "CHF" || (h.includes("CHF") && !h.includes("Total"))
    );
    const totalChfIndex = headers.findIndex(
      (h) => h === "Total CHF" || h.includes("Total CHF")
    );
    const kommentarIndex = headers.findIndex(
      (h) => h === "Kommentar" || h.includes("Kommentar")
    );

    console.log("Column indexes:", {
      ebkp: ebkpIndex,
      bezeichnung: bezeichnungIndex,
      menge: mengeIndex,
      einheit: einheitIndex,
      kennwert: kennwertIndex,
      chf: chfIndex,
      totalChf: totalChfIndex,
      kommentar: kommentarIndex,
    });

    // First pass: identify parent items and create the structure
    jsonData.forEach((row) => {
      const keys = Object.keys(row);
      if (keys.length < 2) return; // Skip rows with insufficient data

      // Get values safely, handling cases where columns might not exist
      const ebkp =
        ebkpIndex >= 0 ? String(row[keys[ebkpIndex]] || "").trim() : "";
      const bezeichnung =
        bezeichnungIndex >= 0
          ? String(row[keys[bezeichnungIndex]] || "").trim()
          : "";

      if (!ebkp) return; // Skip rows without an eBKP code

      // Check if this is a parent row (usually a single letter like "A", "B", etc.)
      const isParent =
        ebkp.length === 1 ||
        (ebkp.length === 2 && !isNaN(Number(ebkp.charAt(1))));

      if (isParent) {
        // This is a parent item
        const totalValue =
          totalChfIndex >= 0 ? Number(row[keys[totalChfIndex]] || 0) : 0;
        const kommentar =
          kommentarIndex >= 0 ? String(row[keys[kommentarIndex]] || "") : "";

        const parentItem: CostItem = {
          code: ebkp,
          description: bezeichnung,
          totalPrice: isNaN(totalValue) ? 0 : totalValue,
          kommentar: kommentar,
          children: [],
          isParent: true,
          level: 0,
        };

        hierarchicalData.push(parentItem);
        parentMap[ebkp] = parentItem;
      } else if (ebkp && ebkp.length >= 2) {
        // This is a child item
        // Extract parent code (e.g., "B" from "B06.01")
        const parentCode = ebkp.charAt(0);
        const parent = parentMap[parentCode];

        if (parent) {
          // Extract values safely
          const menge =
            mengeIndex >= 0 ? Number(row[keys[mengeIndex]] || 0) : 0;
          const einheit =
            einheitIndex >= 0 ? String(row[keys[einheitIndex]] || "") : "";
          const kennwert =
            kennwertIndex >= 0 ? Number(row[keys[kennwertIndex]] || 0) : 0;
          const chf = chfIndex >= 0 ? Number(row[keys[chfIndex]] || 0) : 0;
          const totalChf =
            totalChfIndex >= 0 ? Number(row[keys[totalChfIndex]] || 0) : 0;
          const kommentar =
            kommentarIndex >= 0 ? String(row[keys[kommentarIndex]] || "") : "";

          const childItem: CostItem = {
            code: ebkp,
            description: bezeichnung,
            quantity: isNaN(menge) ? null : menge,
            unit: einheit,
            kennwert: isNaN(kennwert) ? null : kennwert,
            unitPrice: isNaN(chf) ? null : chf,
            totalPrice: isNaN(totalChf) ? null : totalChf,
            kommentar: kommentar,
            level: 1,
          };

          parent.children?.push(childItem);
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

          // Get the header row to check for column existence
          const headerRow = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
          })[0] as string[];

          // Convert to JSON with defval option to include empty cells
          const jsonData = XLSX.utils.sheet_to_json(worksheet, {
            defval: "", // Include empty cells with empty string
          }) as ExcelRow[];

          // Check if all required headers exist in the header row
          const missingHeaders = REQUIRED_HEADERS.filter(
            (header) => !headerRow.includes(header)
          );
          const valid = jsonData.length > 0 && missingHeaders.length === 0;

          // Process the data to create a hierarchical structure
          const processedData = processExcelData(jsonData, headerRow);

          setMetaFile({
            file: file,
            data: processedData,
            headers: headerRow,
            missingHeaders: missingHeaders,
            valid: valid,
          });

          setIsLoading(false);
        } catch (error) {
          console.error("Error processing Excel file:", error);
          setMetaFile({
            file: file,
            data: [],
            headers: [],
            missingHeaders: REQUIRED_HEADERS,
            valid: false,
          });
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
      <>
        {metaFile.missingHeaders && metaFile.missingHeaders.length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Fehlende Spalten in der Excel-Datei:{" "}
            {metaFile.missingHeaders.join(", ")}
          </Alert>
        )}
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
                    borderBottom: "1px solid rgba(224, 224, 224, 1)",
                  }}
                ></TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    width: "80px",
                    padding: isMobile ? "8px 4px" : undefined,
                    borderBottom: "1px solid rgba(224, 224, 224, 1)",
                  }}
                >
                  eBKP
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    width: "250px",
                    padding: isMobile ? "8px 4px" : undefined,
                    borderBottom: "1px solid rgba(224, 224, 224, 1)",
                  }}
                >
                  Bezeichnung
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    width: "80px",
                    padding: isMobile ? "8px 4px" : undefined,
                    borderBottom: "1px solid rgba(224, 224, 224, 1)",
                    textAlign: "right",
                  }}
                >
                  Menge
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    width: "80px",
                    padding: isMobile ? "8px 4px" : undefined,
                    borderBottom: "1px solid rgba(224, 224, 224, 1)",
                  }}
                >
                  Einheit
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    width: "100px",
                    padding: isMobile ? "8px 4px" : undefined,
                    backgroundColor: "rgba(255, 248, 230, 0.3)",
                    borderRight: "1px dashed #ccc",
                    borderBottom: "1px solid rgba(224, 224, 224, 1)",
                    textAlign: "right",
                  }}
                >
                  <span>Kennwert</span>
                  {!isMobile && (
                    <ArrowRightAltIcon
                      fontSize="small"
                      sx={{ verticalAlign: "middle", ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    width: "100px",
                    padding: isMobile ? "8px 4px" : undefined,
                    backgroundColor: "rgba(230, 255, 230, 0.3)",
                    borderRight: "1px dashed #ccc",
                    borderBottom: "1px solid rgba(224, 224, 224, 1)",
                    textAlign: "right",
                  }}
                >
                  <span>CHF</span>
                  {!isMobile && (
                    <ArrowRightAltIcon
                      fontSize="small"
                      sx={{ verticalAlign: "middle", ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    width: "100px",
                    padding: isMobile ? "8px 4px" : undefined,
                    backgroundColor: "rgba(230, 255, 230, 0.5)",
                    borderBottom: "1px solid rgba(224, 224, 224, 1)",
                    textAlign: "right",
                  }}
                >
                  Total CHF
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    width: "120px",
                    padding: isMobile ? "8px 4px" : undefined,
                    borderBottom: "1px solid rgba(224, 224, 224, 1)",
                  }}
                >
                  Kommentar
                </TableCell>
              </TableRow>
              <TableRow
                sx={{
                  display: isMobile ? "none" : "table-row",
                  backgroundColor: "background.paper",
                }}
              >
                <TableCell colSpan={5}></TableCell>
                <TableCell
                  sx={{
                    fontSize: "0.75rem",
                    color: "#666",
                    pt: 0,
                    textAlign: "center",
                  }}
                >
                  Eingabe
                </TableCell>
                <TableCell
                  sx={{
                    fontSize: "0.75rem",
                    color: "#666",
                    pt: 0,
                    textAlign: "center",
                  }}
                >
                  Berechnet
                </TableCell>
                <TableCell
                  sx={{
                    fontSize: "0.75rem",
                    color: "#666",
                    pt: 0,
                    textAlign: "center",
                  }}
                >
                  Total
                </TableCell>
                <TableCell></TableCell>
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
                    <TableCell
                      sx={{ padding: isMobile ? "8px 4px" : undefined }}
                    >
                      {parentItem.children &&
                        parentItem.children.length > 0 && (
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
                        width: "80px",
                      }}
                    >
                      {parentItem.code}
                    </TableCell>
                    <TableCell
                      sx={{
                        fontWeight: "bold",
                        padding: isMobile ? "8px 4px" : undefined,
                        width: "250px",
                      }}
                    >
                      {parentItem.description}
                    </TableCell>
                    <TableCell
                      sx={{
                        padding: isMobile ? "8px 4px" : undefined,
                        width: "80px",
                        textAlign: "right",
                      }}
                    ></TableCell>
                    <TableCell
                      sx={{
                        padding: isMobile ? "8px 4px" : undefined,
                        width: "80px",
                      }}
                    ></TableCell>
                    <TableCell
                      sx={{
                        padding: isMobile ? "8px 4px" : undefined,
                        width: "100px",
                        textAlign: "right",
                      }}
                    ></TableCell>
                    <TableCell
                      sx={{
                        padding: isMobile ? "8px 4px" : undefined,
                        width: "100px",
                        textAlign: "right",
                      }}
                    ></TableCell>
                    <TableCell
                      sx={{
                        fontWeight: "bold",
                        padding: isMobile ? "8px 4px" : undefined,
                        backgroundColor: "rgba(230, 255, 230, 0.5)",
                        width: "100px",
                        textAlign: "right",
                      }}
                    >
                      {typeof parentItem.totalPrice === "number" &&
                      parentItem.totalPrice !== null &&
                      !isNaN(parentItem.totalPrice) &&
                      parentItem.totalPrice !== 0
                        ? parentItem.totalPrice.toLocaleString("de-CH", {
                            minimumFractionDigits: 2,
                          })
                        : ""}
                    </TableCell>
                    <TableCell
                      sx={{
                        padding: isMobile ? "8px 4px" : undefined,
                        width: "120px",
                      }}
                    >
                      {parentItem.kommentar || ""}
                    </TableCell>
                  </TableRow>
                  <TableRow key={`${parentItem.code}-children`}>
                    <TableCell
                      style={{ paddingBottom: 0, paddingTop: 0 }}
                      colSpan={10}
                    >
                      <Collapse
                        in={expandedRows[parentItem.code]}
                        timeout="auto"
                        unmountOnExit
                      >
                        <Box sx={{ margin: 1 }}>
                          <Table size="small" aria-label="child items">
                            <TableBody>
                              {parentItem.children?.map(
                                (childItem: CostItem) => (
                                  <TableRow key={childItem.code} hover>
                                    <TableCell
                                      sx={{
                                        padding: isMobile
                                          ? "8px 4px"
                                          : undefined,
                                        width: "40px",
                                      }}
                                    ></TableCell>
                                    <TableCell
                                      sx={{
                                        padding: isMobile
                                          ? "8px 4px"
                                          : undefined,
                                        width: "80px",
                                      }}
                                    >
                                      {childItem.code}
                                    </TableCell>
                                    <TableCell
                                      sx={{
                                        padding: isMobile
                                          ? "8px 4px"
                                          : undefined,
                                        width: "250px",
                                      }}
                                    >
                                      {childItem.description}
                                    </TableCell>
                                    <TableCell
                                      sx={{
                                        padding: isMobile
                                          ? "8px 4px"
                                          : undefined,
                                        width: "80px",
                                        textAlign: "right",
                                      }}
                                    >
                                      {typeof childItem.quantity === "number" &&
                                      childItem.quantity !== null &&
                                      !isNaN(childItem.quantity) &&
                                      childItem.quantity !== 0
                                        ? childItem.quantity.toLocaleString(
                                            "de-CH"
                                          )
                                        : ""}
                                    </TableCell>
                                    <TableCell
                                      sx={{
                                        padding: isMobile
                                          ? "8px 4px"
                                          : undefined,
                                        width: "80px",
                                      }}
                                    >
                                      {childItem.unit || ""}
                                    </TableCell>
                                    <TableCell
                                      sx={{
                                        padding: isMobile
                                          ? "8px 4px"
                                          : undefined,
                                        width: "100px",
                                        textAlign: "right",
                                      }}
                                    >
                                      <Typography sx={{ fontWeight: "normal" }}>
                                        {typeof childItem.kennwert ===
                                          "number" &&
                                        childItem.kennwert !== null &&
                                        !isNaN(childItem.kennwert) &&
                                        childItem.kennwert !== 0
                                          ? childItem.kennwert.toLocaleString(
                                              "de-CH",
                                              { minimumFractionDigits: 2 }
                                            )
                                          : ""}
                                      </Typography>
                                    </TableCell>
                                    <TableCell
                                      sx={{
                                        padding: isMobile
                                          ? "8px 4px"
                                          : undefined,
                                        backgroundColor:
                                          "rgba(230, 255, 230, 0.3)",
                                        width: "100px",
                                        textAlign: "right",
                                      }}
                                    >
                                      <Typography sx={{ fontWeight: "normal" }}>
                                        {typeof childItem.unitPrice ===
                                          "number" &&
                                        childItem.unitPrice !== null &&
                                        !isNaN(childItem.unitPrice) &&
                                        childItem.unitPrice !== 0
                                          ? childItem.unitPrice.toLocaleString(
                                              "de-CH",
                                              { minimumFractionDigits: 2 }
                                            )
                                          : ""}
                                      </Typography>
                                    </TableCell>
                                    <TableCell
                                      sx={{
                                        padding: isMobile
                                          ? "8px 4px"
                                          : undefined,
                                        width: "100px",
                                        textAlign: "right",
                                      }}
                                    >
                                      <Typography sx={{ fontWeight: "normal" }}>
                                        {typeof childItem.totalPrice ===
                                          "number" &&
                                        childItem.totalPrice !== null &&
                                        !isNaN(childItem.totalPrice) &&
                                        childItem.totalPrice !== 0
                                          ? childItem.totalPrice.toLocaleString(
                                              "de-CH",
                                              { minimumFractionDigits: 2 }
                                            )
                                          : ""}
                                      </Typography>
                                    </TableCell>
                                    <TableCell
                                      sx={{
                                        padding: isMobile
                                          ? "8px 4px"
                                          : undefined,
                                        width: "120px",
                                      }}
                                    >
                                      {childItem.kommentar || ""}
                                    </TableCell>
                                  </TableRow>
                                )
                              )}
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
      </>
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
            <div>
              <UploadFileIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body1" color="primary">
                Lassen Sie die Excel-Datei hier fallen...
              </Typography>
            </div>
          ) : (
            <div>
              <UploadFileIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="body1" color="textPrimary">
                Drag and Drop
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Format: Excel (.xlsx, .xls)
              </Typography>
            </div>
          )}
        </Paper>
      ) : (
        <div>
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
        </div>
      )}
    </div>
  );
};

export default CostUploader;
