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
  const [currentCostData, setCurrentCostData] = useState<CostItem[]>([]);

  // Get the Kafka context for WebSocket connection and MongoDB access
  const {
    connectionStatus,
    mongoGetElements,
    mongoProjectCost,
    sendCostUpdate,
    projectUpdates,
  } = useKafka();

  // Add state for managing project data
  const [loadingElements, setLoadingElements] = useState(false);
  const [projectStats, setProjectStats] = useState({
    totalElements: 0,
    elementsWithCost: 0,
    totalCost: 0,
    lastUpdated: "",
  });
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

  // Function to receive uploaded files from CostUploader
  const handleFileUploaded = (
    fileName: string,
    date?: string,
    status?: string,
    costData?: CostItem[],
    isUpdate?: boolean
  ) => {
    // Store the most recent cost data for Kafka-based calculations
    if (costData && costData.length > 0) {
      setCurrentCostData(costData);
    }

    // Calculate total from cost data if available
    let totalCost = 0;
    if (costData && costData.length > 0) {
      // The initial total cost is calculated here but will be updated
      // by the useEffect when Kafka data changes
      totalCost = calculateTotalCost(costData);
    }

    // Handle file removal
    if (status === "Gelöscht") {
      setTotalCostSum(0); // Reset the total when a file is removed
      setCurrentCostData([]); // Clear the current cost data

      // Update the file's status to "Gelöscht" instead of removing it
      setUploadedFiles((prev) =>
        prev.map((file) =>
          file.name === fileName
            ? {
                ...file,
                status: "Gelöscht",
                date: date || file.date,
                totalCost: 0,
              }
            : file
        )
      );

      return; // Exit early since we've handled the deletion
    } else {
      // For all new uploads and updates, set the total cost to this file's cost
      // This replaces the previous total rather than adding to it
      setTotalCostSum(totalCost);
    }

    if (isUpdate) {
      // Update the existing entry with "Vorschau" status to "Erfolgreich"
      setUploadedFiles((prev) =>
        prev.map((file) =>
          file.name === fileName && file.status === "Vorschau"
            ? {
                ...file,
                status: "Erfolgreich",
                date: date || file.date,
                totalCost: totalCost,
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
          totalCost: totalCost,
        },
        ...prev,
      ]);
    }
  };

  const formatCurrency = (amount: number): string => {
    return amount.toLocaleString("de-CH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Calculate the total cost from the cost data tree
  const calculateTotalCost = (items: CostItem[]): number => {
    return items.reduce((acc, item) => {
      // If the item has a cost, add it
      const itemCost = item.cost || 0;

      // If the item has children, add their costs recursively
      const childrenCost = item.children
        ? calculateTotalCost(item.children)
        : 0;

      return acc + itemCost + childrenCost;
    }, 0);
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
        } catch (error) {
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

          // Count elements that have been mapped by eBKP
          const ebkpCode =
            element.classification?.id || element.properties?.ebkph;
          if (ebkpCode && ebkpCode !== "Unknown") {
            ebkpCounts[ebkpCode] = (ebkpCounts[ebkpCode] || 0) + 1;
          }
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

        // Calculate project statistics
        let elementsWithCost = 0;
        let totalCost = 0;

        elements.forEach((element) => {
          // Count elements that have been mapped by eBKP
          const ebkpCode =
            element.classification?.id || element.properties?.ebkph;
          if (ebkpCode && ebkpCode !== "Unknown") {
            elementsWithCost++;
          }
          // Also track total cost if available
          if (element.cost && element.cost > 0) {
            totalCost += element.cost;
          }
        });

        // Update project stats
        setProjectStats({
          totalElements: elements.length,
          elementsWithCost: elementsWithCost,
          totalCost: totalCost,
          lastUpdated: new Date().toISOString(),
        });

        // Update total cost
        setTotalCost(totalCost);

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
    } catch (error) {
      console.error(
        `Error fetching elements for project ${projectName}:`,
        error
      );

      // Reset states on error
      setCurrentElements([]);
      setElementsByCategory({});
      setElementsByEbkp({});
      setLoadingElements(false);

      return [];
    }
  };

  // Create a function to set the total cost
  const setTotalCost = (cost: number) => {
    setTotalCostSum(cost);
  };

  // Update WebSocket connection in useEffect
  useEffect(() => {
    // Check if WebSocket is supported
    if (!("WebSocket" in window)) {
      console.error("WebSockets are not supported in this browser");
      return;
    }

    let ws: WebSocket | null = null;
    let wsUrl = "ws://localhost:8001";

    try {
      // Try to get the WebSocket URL from the environment
      if (import.meta.env && import.meta.env.VITE_WEBSOCKET_URL) {
        wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
      }

      // Create connection with proper error handling
      ws = new WebSocket(wsUrl);

      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.OPEN) {
          console.warn("WebSocket connection timeout");
          ws.close();
        }
      }, 5000);

      ws.onopen = () => {
        console.log("WebSocket connection established");
        clearTimeout(connectionTimeout);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Received WebSocket message:", data);
          handleWSMessage(data);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = (event) => {
        console.log(
          `WebSocket connection closed: code=${event.code}, reason=${event.reason}`
        );
        clearTimeout(connectionTimeout);
      };
    } catch (error) {
      console.error("Failed to initialize WebSocket:", error);
    }

    // Cleanup function
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Handle WebSocket message types
  const handleWSMessage = (data: any) => {
    if (data.type === "kafka_status") {
      console.log("Kafka status:", data.status);
    }
    // Add handler for project_update messages
    else if (data.type === "project_update") {
      console.log("Received project update:", data);

      // Find the matching project by projectId instead of key
      const projectEntry = Object.entries(projectDetails).find(
        ([name, details]) => details.id === data.projectId
      );

      if (projectEntry) {
        const [projectName, projectInfo] = projectEntry;

        // Update total cost if this project matches the currently selected project
        if (projectName === selectedProject) {
          console.log(`Updating cost data for project: ${data.projectName}`);
          setTotalCost(data.totalCost);

          // Trigger data refresh for the selected project
          setLoadingElements(true);
          fetchElementsForProject(projectName)
            .then((elements) => {
              if (elements) {
                // Update project stats
                setProjectStats({
                  totalElements: data.totalElements || elements.length,
                  elementsWithCost: data.elementsWithCost || 0,
                  totalCost: data.totalCost || 0,
                  lastUpdated: data.timestamp || new Date().toISOString(),
                });
              }
              setLoadingElements(false);
            })
            .catch((error) => {
              console.error("Error refreshing project data:", error);
              setLoadingElements(false);
            });
        } else {
          console.log(
            `Ignoring project update for ${data.projectName} - current project is ${selectedProject}`
          );
        }
      }
    } else if (data.category && data.ebkph) {
      // Handle IFC element messages
      // ... existing element handling code ...
    }
  };

  // Define the handler for project change
  const handleProjectChange = (
    event: React.ChangeEvent<{ value: unknown }>
  ) => {
    const newProject = event.target.value as string;
    setSelectedProject(newProject);

    // Request data for the newly selected project
    setLoadingElements(true);

    // Get project info from project details
    const projectInfo = projectDetails[newProject];
    const realProjectName = projectInfo?.name || newProject;

    fetchElementsForProject(newProject)
      .then((elements) => {
        if (elements && elements.length > 0) {
          console.log(
            `Loaded ${elements.length} elements for project ${realProjectName}`
          );

          // Calculate project statistics
          let elementsWithCost = 0;
          let totalCost = 0;

          elements.forEach((element) => {
            // Count elements that have been mapped by eBKP
            const ebkpCode =
              element.classification?.id || element.properties?.ebkph;
            if (ebkpCode && ebkpCode !== "Unknown") {
              elementsWithCost++;
            }
            // Also track total cost if available
            if (element.cost && element.cost > 0) {
              totalCost += element.cost;
            }
          });

          // Check if we have data from projectUpdates
          const projectId = projectInfo?.id;
          const projectUpdate = Object.values(projectUpdates).find(
            (update) => update.projectId === projectId
          );

          if (projectUpdate) {
            elementsWithCost = projectUpdate.elementCount || elementsWithCost;
            totalCost = projectUpdate.totalCost || totalCost;
          }

          // Update project stats
          setProjectStats({
            totalElements: elements.length,
            elementsWithCost: elementsWithCost,
            totalCost: totalCost,
            lastUpdated: new Date().toISOString(),
          });

          // Update total cost
          setTotalCost(totalCost);
        } else {
          // Reset stats if no elements found
          setProjectStats({
            totalElements: 0,
            elementsWithCost: 0,
            totalCost: 0,
            lastUpdated: new Date().toISOString(),
          });
          setTotalCost(0);
          setCurrentElements([]);
          setElementsByCategory({});
          setElementsByEbkp({});
        }
      })
      .catch((error) => {
        console.error("Error loading elements:", error);
      })
      .finally(() => {
        setLoadingElements(false);
      });
  };

  // Load project data on component mount
  useEffect(() => {
    // Load data for the initially selected project
    if (selectedProject) {
      setLoadingElements(true);
      fetchElementsForProject(selectedProject)
        .then((elements) => {
          if (elements && elements.length > 0) {
            // Calculate project statistics
            let elementsWithCost = 0;
            let totalCost = 0;

            elements.forEach((element) => {
              // Count elements that have been mapped by eBKP
              const ebkpCode =
                element.classification?.id || element.properties?.ebkph;
              if (ebkpCode && ebkpCode !== "Unknown") {
                elementsWithCost++;
              }
              // Also track total cost if available
              if (element.cost && element.cost > 0) {
                totalCost += element.cost;
              }
            });

            // Update project stats
            setProjectStats({
              totalElements: elements.length,
              elementsWithCost: elementsWithCost,
              totalCost: totalCost,
              lastUpdated: new Date().toISOString(),
            });

            // Update total cost if there are no uploaded cost files yet
            if (uploadedFiles.length === 0) {
              setTotalCost(totalCost);
            }
          }
        })
        .catch((error) => {
          console.error("Error loading initial project data:", error);
        })
        .finally(() => {
          setLoadingElements(false);
        });
    }
  }, []);

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

  // Send Kafka notification about cost update directly using project name
  const sendCostUpdateNotification = async (
    projectName: string,
    totalCost: number,
    elementsWithCost: number
  ) => {
    console.log(`Sending cost update notification for project ${projectName}`);
    console.log(
      `Total cost: ${totalCost}, Elements with cost: ${elementsWithCost}`
    );

    // Get project ID if available (but it's not required anymore)
    const projectId = projectDetails[projectName]?.id || "";

    // Use the sendCostUpdate function from KafkaContext with project name as the main identifier
    const success = await sendCostUpdate(
      projectId, // Can be empty string - backend now works with names
      projectName, // This is now the main identifier
      totalCost,
      elementsWithCost
    );

    if (success) {
      console.log(
        `Successfully sent cost update notification for ${projectName}`
      );
    } else {
      console.error(
        `Failed to send cost update notification for ${projectName}`
      );
    }

    return success;
  };

  return (
    <Box sx={{ padding: "20px" }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h4" component="h1">
          Kostenplanung
        </Typography>
      </Box>

      <div className="w-full flex h-full overflow-hidden">
        {/* Sidebar */}
        <div className="w-1/4 min-w-[300px] max-w-[400px] p-8 bg-light text-primary flex flex-col h-full">
          {/* Header und Inhalte */}
          <div className="flex flex-col flex-grow overflow-hidden">
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

            {/* Template Download Section */}
            <div className="mt-4 mb-4">
              <Typography
                variant="subtitle1"
                className="font-bold mb-2"
                color="primary"
              >
                Vorlage
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Button
                variant="outlined"
                color="primary"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={handleTemplateDownload}
                fullWidth
                sx={{ mt: 1 }}
              >
                Kosten-Template herunterladen
              </Button>
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

            {/* Project Statistics Box */}
            <Box
              sx={{
                p: 2,
                mt: 4,
                mb: 2,
                border: "1px solid #e0e0e0",
                borderRadius: 1,
                background: "#f5f5f5",
              }}
            >
              <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>
                Projektdaten
                {loadingElements && (
                  <Chip
                    size="small"
                    color="info"
                    label="Aktualisiere..."
                    variant="outlined"
                    sx={{ ml: 1, height: 20, fontSize: "0.7rem" }}
                  />
                )}
              </Typography>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between">
                  <Typography variant="body2" color="text.secondary">
                    Elemente gesamt:
                  </Typography>
                  <Typography variant="body2" fontWeight="medium">
                    {projectStats.totalElements}
                  </Typography>
                </div>

                <div className="flex justify-between">
                  <Typography variant="body2" color="text.secondary">
                    Elemente mit Kosten:
                  </Typography>
                  <Typography variant="body2" fontWeight="medium">
                    {projectStats.elementsWithCost}
                  </Typography>
                </div>

                {projectStats.lastUpdated && (
                  <div className="flex justify-between">
                    <Typography variant="body2" color="text.secondary">
                      Letzte Aktualisierung:
                    </Typography>
                    <Typography variant="body2" fontWeight="medium">
                      {new Date(projectStats.lastUpdated).toLocaleTimeString()}
                    </Typography>
                  </div>
                )}
              </div>
            </Box>

            {/* Project Elements Box - New section to replace KafkaConsole */}
            <Box
              sx={{
                p: 2,
                mt: 1,
                mb: 2,
                border: "1px solid #e0e0e0",
                borderRadius: 1,
                background: "#f5f5f5",
                maxHeight: "350px",
                overflow: "auto",
              }}
            >
              <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
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

              {renderElementStats()}
            </Box>

            {/* Hochgeladene Dateien Section */}
            <div
              className="mb-6 mt-4 flex-grow flex flex-col overflow-hidden"
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
                {uploadedFiles.length > 0 ? (
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
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Keine Dateien hochgeladen
                  </Typography>
                )}
              </div>
            </div>
          </div>

          {/* Fusszeile */}
          <div className="flex flex-col flex-1 mt-auto">
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
    </Box>
  );
};

export default MainPage;
