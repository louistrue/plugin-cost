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
} from "@mui/material";
import { useState } from "react";
import CostUploader from "./CostUploader";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";

// Define a type for uploaded files with date and status
type UploadedFile = {
  name: string;
  date: string;
  status: string;
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

  // Function to receive uploaded files from CostUploader
  const handleFileUploaded = (
    fileName: string,
    date?: string,
    status?: string
  ) => {
    setUploadedFiles((prev) => [
      ...prev,
      {
        name: fileName,
        date: date || new Date().toLocaleString("de-CH"),
        status: status || "Erfolgreich",
      },
    ]);
  };

  return (
    <div className="w-full flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-1/4 p-8 bg-light text-primary flex flex-col">
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
        </div>

        {/* Fußzeile */}
        <div className="flex mt-auto flex-col">
          {/* Hochgeladene Dateien Section */}
          <div className="mb-10">
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
                            color="success"
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
      <div className="flex-grow flex flex-col h-full">
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
