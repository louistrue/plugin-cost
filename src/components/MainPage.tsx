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
  Button,
  CircularProgress,
  SelectChangeEvent,
} from "@mui/material";
import { useState, useEffect } from "react";
import CostUploader from "./CostUploader/index";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import { CostItem } from "./CostUploader/types";
import { useKafka } from "../contexts/KafkaContext";

// Define a type for uploaded files with date and status
type UploadedFile = {
  name: string;
  date: string;
  status: string;
  totalCost?: number;
};

// MongoDB element data structure
interface MongoElement {
  _id: string;
  project_id: string;
  element_type: string;
  quantity: number;
  properties: {
    category?: string;
    level?: string;
    area?: number;
    is_structural?: boolean;
    is_external?: boolean;
    ebkph?: string;
  };
  classification?: {
    id: string;
    name: string;
    system: string;
  };
  created_at: string;
  updated_at: string;
}

// Project data with real name mapping
interface ProjectDetails {
  id: string;
  name: string;
  elements?: MongoElement[];
}

// Define a type for project cost summary data
interface ProjectCostSummary {
  created_at: string;
  elements_count: number;
  cost_data_count: number;
  total_from_cost_data: number;
  total_from_elements: number;
  updated_at: string;
}

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

  // Define project details with the project name as the key instead of "Projekt 1", etc.
  const projectDetailsMap: Record<string, ProjectDetails> = {
    "Recyclingzentrum Juch-Areal": {
      id: "67e391836c096bf72bc23d97",
      name: "Recyclingzentrum Juch-Areal",
    },
    "Gesamterneuerung Stadthausanlage": {
      id: "67e392836c096bf72bc23d98",
      name: "Gesamterneuerung Stadthausanlage",
    },
    "Amtshaus Walche": {
      id: "67e393836c096bf72bc23d99",
      name: "Amtshaus Walche",
    },
    "Gemeinschaftszentrum Wipkingen": {
      id: "67e394836c096bf72bc23d9a",
      name: "Gemeinschaftszentrum Wipkingen",
    },
  };

  // Set the initial selected project to the first project name
  const [selectedProject, setSelectedProject] = useState(
    Object.keys(projectDetailsMap)[0]
  );
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [totalCostSum, setTotalCostSum] = useState<number>(0);
  const [isLoadingCost, setIsLoadingCost] = useState<boolean>(false);

  // Get the Kafka context for WebSocket connection and MongoDB access
  useKafka();

  // Add state for managing project data
  const [loadingElements, setLoadingElements] = useState(false);
  const [projectDetails, setProjectDetails] =
    useState<Record<string, ProjectDetails>>(projectDetailsMap);

  // State for project elements
  const [currentElements, setCurrentElements] = useState<MongoElement[]>([]);
  const [elementsByEbkp, setElementsByEbkp] = useState<Record<string, number>>(
    {}
  );
  const [elementsByCategory, setElementsByCategory] = useState<
    Record<string, number>
  >({});

  // Function to directly fetch cost summary from the backend
  const fetchProjectCostData = async (projectName: string) => {
    setIsLoadingCost(true);
    try {
      console.log(`Fetching cost data for project: ${projectName}`);

      // Get the backend API base URL
      let apiBaseUrl = "";

      // Determine the API base URL from the WebSocket URL
      let wsUrl = "ws://localhost:8001";
      if ((window as { VITE_WEBSOCKET_URL?: string }).VITE_WEBSOCKET_URL) {
        wsUrl = (window as { VITE_WEBSOCKET_URL?: string }).VITE_WEBSOCKET_URL!;
      } else if (import.meta.env.VITE_WEBSOCKET_URL) {
        wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
      }

      // Convert WebSocket URL to HTTP URL
      const wsProtocol = wsUrl.startsWith("wss:") ? "https:" : "http:";
      const httpUrl = wsUrl.replace(/^ws(s)?:\/\//, "");
      apiBaseUrl = `${wsProtocol}//${httpUrl}`;

      // Encode the project name for the URL
      const encodedProjectName = encodeURIComponent(projectName);

      // Make the API call to get cost summary
      const costApiUrl = `${apiBaseUrl}/project-cost/${encodedProjectName}`;
      console.log(`Fetching cost data from: ${costApiUrl}`);

      const response = await fetch(costApiUrl);

      if (!response.ok) {
        console.warn(
          `Failed to fetch cost data: ${response.status} ${response.statusText}`
        );
        setIsLoadingCost(false);
        return;
      }

      // Parse the response
      const costSummary: ProjectCostSummary = await response.json();
      console.log("Received cost summary:", costSummary);

      // Update the total cost in the UI with the value from MongoDB
      if (costSummary && costSummary.total_from_elements !== undefined) {
        console.log(
          `Setting total cost to ${costSummary.total_from_elements} (from total_from_elements)`
        );
        setTotalCostSum(costSummary.total_from_elements);
      } else if (
        costSummary &&
        costSummary.total_from_cost_data !== undefined
      ) {
        console.log(
          `Falling back to total_from_cost_data: ${costSummary.total_from_cost_data}`
        );
        setTotalCostSum(costSummary.total_from_cost_data);
      } else {
        console.warn(
          "Cost summary is missing both total_from_elements and total_from_cost_data"
        );
      }
    } catch (error) {
      console.error("Error fetching cost data:", error);
    } finally {
      setIsLoadingCost(false);
    }
  };

  // Function to receive uploaded files from CostUploader
  const handleFileUploaded = (
    fileName: string,
    date?: string,
    status?: string,
    costData?: CostItem[],
    isUpdate?: boolean
  ) => {
    // Handle file removal
    if (status === "Gelöscht") {
      // Don't reset the total cost here, instead fetch the latest from the server
      // This ensures we display the server's actual value
      fetchProjectCostData(selectedProject);

      // Update the file's status to "Gelöscht" instead of removing it
      setUploadedFiles((prev) =>
        prev.map((file) =>
          file.name === fileName
            ? {
                ...file,
                status: "Gelöscht",
                date: date || file.date,
              }
            : file
        )
      );

      return; // Exit early since we've handled the deletion
    } else {
      // For all new uploads and updates, we'll set totalCostSum based on
      // the UPLOADED/EXCEL data here temporarily, but will fetch the ACTUAL
      // MongoDB data after the upload completes
      if (costData && costData.length > 0) {
        // Calculate total cost from the cost data
        const calculatedTotal = costData.reduce((sum, item) => {
          // Only add the main row's totalChf value
          return sum + (item.totalChf || 0);
        }, 0);

        console.log(`Setting calculated total from Excel: ${calculatedTotal}`);
        setTotalCostSum(calculatedTotal);
      }
    }

    if (isUpdate) {
      // After update is complete, fetch the real data from the server to get the correct total
      setTimeout(() => {
        console.log("Fetching updated cost data after successful update");
        fetchProjectCostData(selectedProject);
      }, 1000);

      // Update the existing entry with "Vorschau" status to "Erfolgreich"
      setUploadedFiles((prev) =>
        prev.map((file) =>
          file.name === fileName && file.status === "Vorschau"
            ? {
                ...file,
                status: "Erfolgreich",
                date: date || file.date,
              }
            : file
        )
      );
    } else {
      // Add a new file entry with the status
      setUploadedFiles((prev) => [
        {
          name: fileName,
          date: date || new Date().toLocaleDateString(),
          status: status || "Vorschau",
        },
        ...prev,
      ]);
    }
  };

  const formatCurrency = (amount: number): string => {
    return amount.toLocaleString("de-CH", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  // Function to handle template download
  const handleTemplateDownload = () => {
    // Use a direct path relative to the domain root
    const templateUrl = `/templates/241212_Kosten-Template.xlsx`;
    const link = document.createElement("a");
    link.href = templateUrl;
    link.download = "241212_Kosten-Template.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Function to fetch elements for a project directly by name
  const fetchElementsForProject = async (projectName: string) => {
    setLoadingElements(true);

    try {
      console.log(`Fetching elements for project ${projectName}`);

      // We'll use the project name directly - no need for ID lookup
      // Encode the project name for URLs
      const encodedProjectName = encodeURIComponent(projectName);
      console.log(`Using project name for lookup: ${encodedProjectName}`);

      // Get the WebSocket URL base for consistency first
      let wsUrl = "ws://localhost:8001";
      let apiBaseUrl = "";
      let backendAvailable = false;
      try {
        // Try to get the WebSocket URL from the environment
        if (import.meta.env && import.meta.env.VITE_WEBSOCKET_URL) {
          wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
        }

        // Convert WebSocket URL to HTTP URL
        const wsProtocol = wsUrl.startsWith("wss:") ? "https:" : "http:";
        const httpUrl = wsUrl.replace(/^ws(s)?:\/\//, "");
        apiBaseUrl = `${wsProtocol}//${httpUrl}`;

        // Try health endpoint first (common for WebSocket servers)
        try {
          const healthResponse = await fetch(`${apiBaseUrl}/health`, {
            method: "HEAD",
          });
          backendAvailable = healthResponse.ok;
        } catch {
          // If health endpoint fails, try the root path
          const rootResponse = await fetch(apiBaseUrl, { method: "HEAD" });
          backendAvailable = rootResponse.ok;
        }
      } catch (error) {
        console.warn("Backend server appears to be unavailable:", error);
        backendAvailable = false;
      }

      if (!backendAvailable) {
        console.warn("Backend server unavailable, skipping API call");
        setLoadingElements(false);

        // Instead of using mock data, return empty data
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});

        return [];
      }

      // Using the project name directly in the API call
      const apiUrl = `${apiBaseUrl}/project-elements/${encodedProjectName}`;
      console.log(`Fetching from API URL: ${apiUrl}`);
      const response = await fetch(apiUrl);

      // Also fetch cost summary for this project to update the total cost
      await fetchProjectCostData(projectName);

      // Check if response is ok
      if (!response.ok) {
        throw new Error(
          `Failed to fetch elements: ${response.statusText} (${response.status})`
        );
      }

      // Parse response text
      const text = await response.text();
      if (!text || text.trim() === "") {
        console.warn("Empty response received from server");
        setLoadingElements(false);
        return [];
      }

      // Try to parse JSON
      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        console.error("Failed to parse server response as JSON:", error);
        console.debug(
          "Response text:",
          text.substring(0, 200) + (text.length > 200 ? "..." : "")
        );
        setLoadingElements(false);
        return [];
      }

      // Format for processing - make sure we have the expected structure
      // The response is usually an array of elements directly
      const elements = Array.isArray(data) ? data : data.elements || [];

      console.log(
        `Received ${elements.length} elements for project ${projectName}`
      );

      // Process the elements to extract stats
      if (elements && elements.length > 0) {
        // Update current elements
        setCurrentElements(elements);

        // Count elements by category and eBKP code
        const categoryCounts: Record<string, number> = {};
        const ebkpCounts: Record<string, number> = {};

        elements.forEach((element: MongoElement) => {
          // Count by category
          const category = element.properties?.category || "Unknown";
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;

          // Count by eBKP code
          const ebkpCode =
            element.classification?.id ||
            element.properties?.ebkph ||
            "Unknown";
          ebkpCounts[ebkpCode] = (ebkpCounts[ebkpCode] || 0) + 1;
        });

        setElementsByCategory(categoryCounts);
        setElementsByEbkp(ebkpCounts);

        // Store project details if we have a project ID in the elements
        if (elements[0]?.project_id) {
          const projectId = elements[0].project_id;
          setProjectDetails((prev) => ({
            ...prev,
            [projectName]: {
              ...prev[projectName],
              id: projectId,
              elements: elements,
            },
          }));
        }

        // Finish loading
        setLoadingElements(false);

        // Return the elements
        return elements;
      } else {
        // No elements found
        console.log(`No elements found for project ${projectName}`);
        setCurrentElements([]);
        setElementsByCategory({});
        setElementsByEbkp({});
        setLoadingElements(false);
        return [];
      }
    } catch (err) {
      console.error("Error fetching elements:", err);
      setLoadingElements(false);
      return [];
    }
  };

  // Define the handler for project change
  const handleProjectChange = (event: SelectChangeEvent<string>) => {
    const newProject = event.target.value;
    setSelectedProject(newProject);

    // When project changes, fetch both elements and cost data for the new project
    setLoadingElements(true);
    Promise.all([
      fetchElementsForProject(newProject),
      fetchProjectCostData(newProject),
    ])
      .catch((error) => {
        console.error("Error loading project data after change:", error);
      })
      .finally(() => {
        setLoadingElements(false);
      });
  };

  // Load project data on component mount
  useEffect(() => {
    // Load data for the initially selected project, but only once on mount
    if (selectedProject) {
      setLoadingElements(true);
      // Initial data load when the page first opens
      Promise.all([
        fetchElementsForProject(selectedProject),
        fetchProjectCostData(selectedProject),
      ])
        .catch((error) => {
          console.error("Error loading initial project data:", error);
        })
        .finally(() => {
          setLoadingElements(false);
        });
    }
  }, []); // Empty dependency array ensures this only runs once on mount

  // Add a refresh button function for cost data
  const refreshCostData = () => {
    fetchProjectCostData(selectedProject);
  };

  // Function to render element statistics
  const renderElementStats = () => {
    if (loadingElements) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      );
    }

    if (currentElements.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">
          Keine Elemente gefunden für dieses Projekt.
        </Typography>
      );
    }

    return (
      <>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Elemente nach Kategorie:
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {Object.entries(elementsByCategory).map(([category, count]) => (
              <Chip
                key={category}
                label={`${category}: ${count}`}
                size="small"
                variant="outlined"
              />
            ))}
          </Box>
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Elemente nach eBKP:
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {Object.entries(elementsByEbkp).map(([code, count]) => (
              <Chip
                key={code}
                label={`${code}: ${count}`}
                size="small"
                variant="outlined"
                color="primary"
              />
            ))}
          </Box>
        </Box>

        <Box sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Neueste Elemente:
          </Typography>
          <TableContainer sx={{ maxHeight: 200 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Element ID</TableCell>
                  <TableCell>Typ</TableCell>
                  <TableCell>eBKP</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {currentElements.slice(0, 5).map((element) => (
                  <TableRow key={element._id}>
                    <TableCell>{element._id.substring(0, 6)}...</TableCell>
                    <TableCell>{element.element_type}</TableCell>
                    <TableCell>
                      {element.classification?.id ||
                        element.properties.ebkph ||
                        "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {currentElements.length > 5 && (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      <Typography variant="caption" color="text.secondary">
                        {currentElements.length - 5} weitere Elemente...
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </>
    );
  };

  return (
    <Box
      sx={{
        padding: "0",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div className="w-full flex h-full overflow-hidden">
        {/* Sidebar - fixed, no scroll */}
        <div className="w-1/4 min-w-[300px] max-w-[400px] px-8 pt-4 pb-0 bg-light text-primary flex flex-col h-full overflow-y-auto">
          {/* Header und Inhalte */}
          <div className="flex flex-col h-full">
            <Typography variant="h3" className="text-5xl mb-2" color="primary">
              Kosten
            </Typography>
            <div className="flex mt-2 gap-1 flex-col">
              <FormLabel focused htmlFor="select-project">
                Projekt:
              </FormLabel>
              <FormControl variant="outlined" focused>
                <Select
                  id="select-project"
                  size="small"
                  value={selectedProject}
                  onChange={handleProjectChange}
                  labelId="select-project"
                >
                  {Object.keys(projectDetails).map((projectName) => (
                    <MenuItem key={projectName} value={projectName}>
                      {projectName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </div>

            {/* Total Cost Sum Box */}
            <Box
              sx={{
                p: 2,
                mt: 2,
                mb: 2,
                background: "linear-gradient(to right top, #F1D900, #fff176)",
                borderRadius: 1,
                textAlign: "center",
                position: "relative",
              }}
            >
              {isLoadingCost && (
                <CircularProgress
                  size={16}
                  sx={{
                    position: "absolute",
                    top: 5,
                    right: 5,
                    color: "#666",
                  }}
                />
              )}
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
              <Typography
                variant="caption"
                sx={{ mt: 0.5, display: "block", cursor: "pointer" }}
                onClick={refreshCostData}
              >
                Aktualisiert: {new Date().toLocaleTimeString()}
              </Typography>
            </Box>

            {/* Hochgeladene Dateien Section - Only show if there are files */}
            {uploadedFiles.length > 0 && (
              <div
                className="mb-4 mt-2 flex flex-col overflow-hidden"
                style={{ minHeight: "200px" }}
              >
                <Typography
                  variant="subtitle1"
                  className="font-bold mb-2"
                  color="primary"
                >
                  Hochgeladene Dateien
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <div className="flex-grow flex flex-col overflow-hidden">
                  <TableContainer
                    sx={{
                      flex: 1,
                      overflow: "auto",
                      maxHeight: "calc(100% - 40px)",
                    }}
                  >
                    <Table size="small" stickyHeader>
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
                                  file.status === "Vorschau"
                                    ? "warning"
                                    : file.status === "Gelöscht"
                                    ? "default"
                                    : "success"
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
                </div>
              </div>
            )}

            {/* Fusszeile - Position at bottom when files aren't shown */}
            <div
              className={`flex flex-col mt-2 ${
                uploadedFiles.length === 0 ? "mt-auto" : ""
              }`}
            >
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
        </div>

        {/* Hauptbereich - single scrollbar */}
        <div className="flex-1 w-3/4 flex flex-col h-full overflow-hidden">
          <div className="flex-grow px-10 pt-4 pb-10 flex flex-col h-full overflow-y-auto">
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 6,
              }}
            >
              <Typography variant="h2" className="text-5xl">
                Kostendaten hochladen
              </Typography>
              <Button
                variant="outlined"
                color="primary"
                size="medium"
                startIcon={<DownloadIcon />}
                onClick={handleTemplateDownload}
              >
                Kosten-Template herunterladen
              </Button>
            </Box>

            {/* Cost Uploader Component */}
            <div className="flex-grow flex flex-col h-full overflow-hidden">
              <CostUploader
                onFileUploaded={handleFileUploaded}
                totalElements={0}
                totalCost={totalCostSum}
                projectName={selectedProject}
                elementsComponent={
                  <Box
                    sx={{
                      p: 2,
                      mt: 4,
                      mb: 0,
                      border: "1px solid #e0e0e0",
                      borderRadius: 1,
                      background: "#f5f5f5",
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      overflow: "hidden",
                    }}
                  >
                    <Typography
                      variant="subtitle1"
                      fontWeight="bold"
                      sx={{ mb: 2 }}
                    >
                      Projektelemente
                      <Button
                        size="small"
                        startIcon={<RefreshIcon />}
                        onClick={() => fetchElementsForProject(selectedProject)}
                        disabled={loadingElements}
                        variant="outlined"
                        sx={{ ml: 1, height: 20, fontSize: "0.7rem", py: 0 }}
                      >
                        Aktualisieren
                      </Button>
                    </Typography>

                    <Box sx={{ overflow: "auto", flex: 1 }}>
                      {renderElementStats()}
                    </Box>
                  </Box>
                }
              />
            </div>
          </div>
        </div>
      </div>
    </Box>
  );
};

export default MainPage;
