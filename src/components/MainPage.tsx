import {
  Typography,
  Select,
  MenuItem,
  FormControl,
  FormLabel,
  Stepper,
  Step,
  StepLabel,
  Divider,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Chip,
  Box,
} from "@mui/material";
import { useState, useEffect } from "react";
import CostUploader from "./CostUploader/index";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { CostItem } from "./CostUploader/types";

// Define a type for uploaded files with date and status
type UploadedFile = {
  name: string;
  date: string;
  status: string;
  totalCost?: number;
};

const MainPage = () => {
  const Instructions = [
    {
      label: "Kostendaten hochladen",
      description: `Laden Sie Ihre Kostendaten im Excel-Format hoch. Die Daten werden anschließend in einer hierarchischen Übersicht angezeigt.`,
    },
    {
      label: "Daten überprüfen",
      description:
        "Überprüfen Sie die Daten in der Vorschau. Klicken Sie auf die Pfeile, um Details anzuzeigen.",
    },
    {
      label: "Daten senden",
      description:
        "Nach Überprüfung der Daten können Sie diese über den Button 'Daten senden' einreichen.",
    },
  ];

  const [selectedProject, setSelectedProject] = useState("Projekt 1");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [totalCostSum, setTotalCostSum] = useState<number>(0);

  // Calculate total cost sum whenever uploaded files change
  useEffect(() => {
    const newTotal = uploadedFiles.reduce((sum, file) => {
      return sum + (file.totalCost || 0);
    }, 0);
    setTotalCostSum(newTotal);
  }, [uploadedFiles]);

  // Function to receive uploaded files from CostUploader
  const handleFileUploaded = (
    fileName: string,
    date?: string,
    status?: string,
    costData?: CostItem[],
    isUpdate?: boolean
  ) => {
    // Calculate total from cost data if available
    let totalCost = 0;
    if (costData && costData.length > 0) {
      totalCost = calculateTotalCost(costData);
    }

    if (isUpdate) {
      // Update the existing entry with "Vorschau" status to "Erfolgreich"
      setUploadedFiles((prev) =>
        prev.map((file) =>
          file.name === fileName && file.status === "Vorschau"
            ? {
                ...file,
                status: status || "Erfolgreich",
                date: date || file.date,
              }
            : file
        )
      );
    } else {
      // For new uploads, check if we already have a "Vorschau" for this file
      const hasPreview = uploadedFiles.some(
        (file) => file.name === fileName && file.status === "Vorschau"
      );

      if (hasPreview) {
        // Update the existing preview entry
        setUploadedFiles((prev) =>
          prev.map((file) =>
            file.name === fileName && file.status === "Vorschau"
              ? { ...file, totalCost, date: date || file.date }
              : file
          )
        );
      } else {
        // Add a completely new entry
        setUploadedFiles((prev) => [
          ...prev,
          {
            name: fileName,
            date: date || new Date().toLocaleString("de-CH"),
            status: status || "Erfolgreich",
            totalCost: totalCost,
          },
        ]);
      }
    }
  };

  // Function to calculate total cost from all cost items
  const calculateTotalCost = (items: CostItem[]): number => {
    let total = 0;

    // Process all top-level items
    for (const item of items) {
      // Add the totalChf value if it exists
      if (item.totalChf !== null && item.totalChf !== undefined) {
        total += item.totalChf;
      }

      // Recursively process children (this is not usually needed as the parent totalChf
      // should already include all children, but added for completeness)
      if (item.children && item.children.length > 0) {
        total += calculateTotalCost(item.children);
      }
    }

    return total;
  };

  // Format currency with Swiss format
  const formatCurrency = (amount: number): string => {
    return amount.toLocaleString("de-CH", {
      style: "decimal",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="w-full flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-1/4 min-w-[300px] max-w-[400px] p-8 bg-light text-primary flex flex-col">
        {/* Header und Inhalte */}
        <div>
          <Typography variant="h3" className="text-5xl mb-2" color="primary">
            Kosten
          </Typography>
          <div className="flex mt-4 gap-1 flex-col">
            <FormLabel focused htmlFor="select-project">
              Projekt:
            </FormLabel>
            <FormControl variant="outlined" focused>
              <Select
                id="select-project"
                size="small"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                labelId="select-project"
              >
                <MenuItem value={"Projekt 1"}>
                  Recyclingzentrum Juch-Areal
                </MenuItem>
                <MenuItem value={"Projekt 2"}>
                  Gesamterneuerung Stadthausanlage
                </MenuItem>
                <MenuItem value={"Projekt 3"}>Amtshaus Walche</MenuItem>
                <MenuItem value={"Projekt 4"}>
                  Gemeinschaftszentrum Wipkingen
                </MenuItem>
              </Select>
            </FormControl>
          </div>

          {/* Total Cost Sum Box */}
          <Box
            sx={{
              p: 2,
              mt: 4,
              mb: 2,
              background: "linear-gradient(to right top, #F1D900, #fff176)",
              borderRadius: 1,
            }}
          >
            <Typography
              variant="h4"
              component="p"
              color="common.black"
              fontWeight="bold"
            >
              {formatCurrency(totalCostSum)}
              <Typography
                component="span"
                variant="h6"
                sx={{ ml: 1, opacity: 0.7, fontWeight: "normal" }}
              >
                CHF
              </Typography>
            </Typography>
          </Box>

          {/* Hochgeladene Dateien Section - Moved from footer to below total cost box */}
          <div className="mb-6 mt-4">
            <Typography
              variant="subtitle1"
              className="font-bold mb-2"
              color="primary"
            >
              Hochgeladene Dateien
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {uploadedFiles.length > 0 ? (
              <TableContainer sx={{ maxHeight: 200 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell
                        sx={{ padding: "6px 8px", fontWeight: "bold" }}
                      >
                        Dateiname
                      </TableCell>
                      <TableCell
                        sx={{ padding: "6px 8px", fontWeight: "bold" }}
                      >
                        Datum
                      </TableCell>
                      <TableCell
                        sx={{ padding: "6px 8px", fontWeight: "bold" }}
                      >
                        Status
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {uploadedFiles.map((file, index) => (
                      <TableRow key={index} hover>
                        <TableCell
                          sx={{ padding: "6px 8px", fontSize: "0.75rem" }}
                        >
                          <div className="flex items-center">
                            <InsertDriveFileIcon
                              color="primary"
                              fontSize="small"
                              sx={{ mr: 1, fontSize: "1rem" }}
                            />
                            <span style={{ wordBreak: "break-word" }}>
                              {file.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell
                          sx={{ padding: "6px 8px", fontSize: "0.75rem" }}
                        >
                          {file.date}
                        </TableCell>
                        <TableCell
                          sx={{ padding: "6px 8px", fontSize: "0.75rem" }}
                        >
                          <Chip
                            label={file.status}
                            color={
                              file.status === "Vorschau" ? "warning" : "success"
                            }
                            size="small"
                            variant="outlined"
                            sx={{ height: 20, fontSize: "0.7rem" }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Keine Dateien hochgeladen
              </Typography>
            )}
          </div>
        </div>

        {/* Fusszeile */}
        <div className="flex mt-auto flex-col">
          {/* Anleitung Section */}
          <div>
            <Typography
              variant="subtitle1"
              className="font-bold mb-2"
              color="primary"
            >
              Anleitung
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Stepper orientation="vertical" nonLinear className="max-w-xs">
              {Instructions.map((step) => (
                <Step key={step.label} active>
                  <StepLabel>
                    <span
                      className="leading-tight text-primary font-bold"
                      style={{ color: "#0D0599" }}
                    >
                      {step.label}
                    </span>
                  </StepLabel>
                  <div className="ml-8 -mt-2">
                    <span
                      className="text-sm leading-none"
                      style={{ color: "#0D0599" }}
                    >
                      {step.description}
                    </span>
                  </div>
                </Step>
              ))}
            </Stepper>
          </div>
        </div>
      </div>

      {/* Hauptbereich */}
      <div className="flex-1 w-3/4 flex flex-col h-full overflow-hidden">
        <div className="flex-grow overflow-y-auto p-10 flex flex-col h-full">
          <Typography variant="h2" className="text-5xl mb-10">
            Kostendaten hochladen
          </Typography>

          {/* Cost Uploader Component */}
          <div className="flex-grow flex flex-col h-full">
            <CostUploader onFileUploaded={handleFileUploaded} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainPage;
