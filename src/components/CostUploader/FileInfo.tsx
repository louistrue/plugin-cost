import {
  Typography,
  Button,
  IconButton,
  ListItem,
  ListItemIcon,
  Divider,
  Snackbar,
  Alert,
} from "@mui/material";
import { useState, useEffect, useRef, useCallback } from "react";
import { Delete as DeleteIcon } from "@mui/icons-material";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { fileSize } from "./utils";
import { MetaFile, CostItem } from "./types";
import { useKafka } from "../../contexts/KafkaContext";

// Create a global WebSocket instance to be shared across all component instances
let globalWs: WebSocket | null = null;
let globalWsConnected = false;
let globalClientCount = 0;
let pingInterval: ReturnType<typeof setInterval> | null = null;

interface FileInfoProps {
  metaFile: MetaFile;
  onRemoveFile: () => void;
  onSendData: () => void;
}

const FileInfo = ({ metaFile, onRemoveFile, onSendData }: FileInfoProps) => {
  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error" | "info" | "warning";
  }>({
    open: false,
    message: "",
    severity: "info",
  });

  const { getAreaData } = useKafka();
  const [wsConnected, setWsConnected] = useState(globalWsConnected);
  const responseHandlersRef = useRef<{
    [key: string]: (response: Record<string, unknown>) => void;
  }>({});

  // Function to send a message and register a response handler
  const sendMessage = useCallback(
    (
      message: Record<string, unknown>,
      responseHandler?: (response: Record<string, unknown>) => void
    ) => {
      if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
        console.error("Cannot send message - WebSocket not connected");
        return false;
      }

      try {
        // If we have a response handler, register it with a unique message ID
        if (responseHandler) {
          const messageId =
            Date.now().toString() + Math.random().toString(36).substring(2, 10);
          message.messageId = messageId;
          responseHandlersRef.current[messageId] = responseHandler;

          // Auto-cleanup handler after 30 seconds
          setTimeout(() => {
            delete responseHandlersRef.current[messageId];
          }, 30000);
        }

        globalWs.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error("Error sending message:", error);
        return false;
      }
    },
    []
  );

  // Initialize shared WebSocket connection
  useEffect(() => {
    // Global state to track connection attempts
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectWebSocket = () => {
      // Don't reconnect if we already have an active global connection
      if (
        globalWs &&
        (globalWs.readyState === WebSocket.OPEN ||
          globalWs.readyState === WebSocket.CONNECTING)
      ) {
        console.log(
          "Global WebSocket already connected or connecting, using existing connection"
        );
        setWsConnected(globalWsConnected);
        return;
      }

      const wsUrl = import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8001";
      console.log(
        `Initializing global WebSocket at ${wsUrl} (attempt ${
          reconnectAttempts + 1
        })`
      );

      // Create new WebSocket connection
      try {
        const ws = new WebSocket(wsUrl);
        globalWs = ws;

        ws.onopen = () => {
          console.log("Global WebSocket connection opened successfully");
          globalWsConnected = true;
          setWsConnected(true);
          reconnectAttempts = 0; // Reset reconnect counter on successful connection
        };

        ws.onclose = (event) => {
          console.log(
            `Global WebSocket connection closed: code=${event.code}, reason=${
              event.reason || "No reason"
            }`
          );
          globalWsConnected = false;
          setWsConnected(false);
          globalWs = null;

          // Don't attempt to reconnect if the closure was intentional (code 1000)
          if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(
              1000 * Math.pow(2, reconnectAttempts),
              10000
            );
            console.log(
              `Attempting to reconnect in ${delay}ms (attempt ${
                reconnectAttempts + 1
              }/${maxReconnectAttempts})`
            );

            reconnectTimeout = setTimeout(() => {
              reconnectAttempts++;
              connectWebSocket();
            }, delay);
          } else if (reconnectAttempts >= maxReconnectAttempts) {
            console.error("Maximum reconnection attempts reached. Giving up.");
            setNotification({
              open: true,
              message:
                "Failed to connect to server after multiple attempts. Please refresh the page.",
              severity: "error",
            });
          }
        };

        ws.onerror = (event) => {
          console.error("Global WebSocket error:", event);
        };

        // Message handler for WebSocket
        ws.onmessage = (event) => {
          try {
            console.log("Received WebSocket message:", event.data);
            const response = JSON.parse(event.data);

            // Check if this is a response to a message with an ID
            if (
              response.messageId &&
              responseHandlersRef.current[response.messageId]
            ) {
              // Call the registered handler
              responseHandlersRef.current[response.messageId](response);
              // Clean up handler after use
              delete responseHandlersRef.current[response.messageId];
              return;
            }

            if (response.type === "cost_data_response") {
              if (response.status === "success") {
                console.log("Cost data sent successfully");
                setNotification({
                  open: true,
                  message: "Cost data sent successfully",
                  severity: "success",
                });
              } else {
                console.error("Error sending cost data:", response.message);
                setNotification({
                  open: true,
                  message: response.message || "Error sending cost data",
                  severity: "error",
                });
              }
            }
          } catch (error) {
            console.error("Error parsing WebSocket response:", error);
          }
        };
      } catch (error) {
        console.error("Error creating WebSocket:", error);
        globalWsConnected = false;
        setWsConnected(false);

        // Try to reconnect after delay
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
        reconnectTimeout = setTimeout(() => {
          reconnectAttempts++;
          connectWebSocket();
        }, delay);
      }
    };

    // Increment client count and connect if this is the first client
    globalClientCount++;
    console.log(`Component mounted. Client count: ${globalClientCount}`);

    if (globalClientCount === 1) {
      // Initial connection if this is the first client
      connectWebSocket();

      // Set up a ping interval to keep the connection alive
      if (!pingInterval) {
        pingInterval = setInterval(() => {
          if (globalWs && globalWs.readyState === WebSocket.OPEN) {
            console.log("Sending ping to keep WebSocket connection alive");
            try {
              globalWs.send(JSON.stringify({ type: "ping" }));
            } catch (error) {
              console.error("Error sending ping:", error);
            }
          } else if (!globalWs || globalWs.readyState === WebSocket.CLOSED) {
            // If the connection is closed, try to reconnect
            if (reconnectAttempts < maxReconnectAttempts) {
              console.log("Connection lost, attempting to reconnect");
              connectWebSocket();
            }
          }
        }, 30000); // Send a ping every 30 seconds
      }
    } else {
      // If connection already exists, update local state
      setWsConnected(globalWsConnected);
    }

    // Cleanup on unmount
    return () => {
      // Decrement client count
      globalClientCount--;
      console.log(`Component unmounted. Client count: ${globalClientCount}`);

      // If this is the last client, clean up shared resources
      if (globalClientCount === 0) {
        console.log("Last client unmounted, cleaning up shared resources");

        // Clear intervals and timeouts
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }

        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
        }

        // Close WebSocket connection if open
        if (
          globalWs &&
          (globalWs.readyState === WebSocket.OPEN ||
            globalWs.readyState === WebSocket.CONNECTING)
        ) {
          console.log("Closing global WebSocket connection");
          globalWs.close(1000, "Last component unmounting");
          globalWs = null;
          globalWsConnected = false;
        }
      }
    };
  }, []);

  // Prepare cost data for sending to Kafka
  const prepareCostData = useCallback(() => {
    console.log("Preparing cost data, metaFile:", metaFile);

    // More detailed validation
    if (!metaFile) {
      throw new Error("No metaFile available");
    }

    if (!metaFile.data) {
      throw new Error("No data in metaFile");
    }

    // Check if data is an array directly (from Excel)
    if (Array.isArray(metaFile.data)) {
      console.log("Data is an array directly, using it as the source");

      if (metaFile.data.length === 0) {
        throw new Error("Data array is empty");
      }

      // Get all cost items (recursive function to flatten nested structure)
      const getAllItems = (items: CostItem[]): CostItem[] => {
        let result: CostItem[] = [];
        for (const item of items) {
          result.push(item);
          if (item.children && item.children.length > 0) {
            result = result.concat(getAllItems(item.children));
          }
        }
        return result;
      };

      // Get all items including nested children
      const allItems = getAllItems(metaFile.data);

      // Format to expected structure
      const costData = {
        project: "excel-import", // Default project name for Excel
        filename: metaFile.file.name,
        timestamp: new Date().toISOString(),
        data: allItems
          .filter(
            (item) =>
              item.ebkp && item.menge !== null && item.menge !== undefined
          )
          .map((item) => {
            // Get eBKP code and cost information
            const ebkp = item.ebkp || "";
            const costUnit = item.kennwert || 0;
            const cost = (item.menge || 0) * costUnit;

            // Get area data from Kafka if available
            const areaData = ebkp ? getAreaData(ebkp) : null;

            return {
              id: item.id || `cost-${ebkp}`,
              category: item.bezeichnung || "",
              level: "", // Not available in Excel data
              is_structural: true, // Default
              fire_rating: "", // Not available in Excel data
              ebkph: ebkp,
              cost: cost,
              cost_unit: costUnit,
              // Include area from Kafka if available
              area: areaData?.value || item.menge || 0,
              // Include timestamp if available from Kafka
              timestamp: areaData?.timestamp || new Date().toISOString(),
            };
          }),
      };

      return costData;
    }
    // Check if data has a data property (nested structure)
    else if (metaFile.data.data && Array.isArray(metaFile.data.data)) {
      console.log("Data has nested data array, using metaFile.data.data");

      if (metaFile.data.data.length === 0) {
        throw new Error("Data array is empty");
      }

      // The rest of the code from before
      const getAllItems = (items: CostItem[]): CostItem[] => {
        let result: CostItem[] = [];
        for (const item of items) {
          result.push(item);
          if (item.children && item.children.length > 0) {
            result = result.concat(getAllItems(item.children));
          }
        }
        return result;
      };

      // Get all items including nested children
      const allItems = getAllItems(metaFile.data.data);

      // Format to expected structure
      const costData = {
        project: metaFile.data.project || "unknown",
        filename: metaFile.file.name,
        timestamp: new Date().toISOString(),
        data: allItems
          .filter(
            (item) =>
              item.ebkp && item.menge !== null && item.menge !== undefined
          )
          .map((item) => {
            // Get eBKP code and cost information
            const ebkp = item.ebkp || "";
            const costUnit = item.kennwert || 0;
            const cost = (item.menge || 0) * costUnit;

            // Get area data from Kafka if available
            const areaData = ebkp ? getAreaData(ebkp) : null;

            return {
              id: item.id || `cost-${ebkp}`,
              category: item.bezeichnung || "",
              level: "", // Not available in Excel data
              is_structural: true, // Default
              fire_rating: "", // Not available in Excel data
              ebkph: ebkp,
              cost: cost,
              cost_unit: costUnit,
              // Include area from Kafka if available
              area: areaData?.value || item.menge || 0,
              // Include timestamp if available from Kafka
              timestamp: areaData?.timestamp || new Date().toISOString(),
            };
          }),
      };

      return costData;
    } else {
      console.error(
        "MetaFile structure:",
        JSON.stringify(metaFile, null, 2).substring(0, 500) + "..."
      );
      throw new Error(
        "Invalid data structure: could not find a valid data array"
      );
    }
  }, [metaFile, getAreaData]);

  // Send cost data to the server
  const sendCostDataToServer = useCallback(async () => {
    try {
      // Check if WebSocket is connected
      if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
        console.error("WebSocket not connected, cannot send data");
        setNotification({
          open: true,
          message:
            "WebSocket not connected. Please wait for the connection to establish.",
          severity: "error",
        });
        return;
      }

      // Prepare the data
      const costData = prepareCostData();
      console.log(
        "Cost data prepared:",
        JSON.stringify(costData).substring(0, 200) + "..."
      );

      // Send the data with a response handler
      sendMessage({ type: "cost_data", data: costData }, (response) => {
        if (response.status === "success") {
          setNotification({
            open: true,
            message: "Cost data sent successfully",
            severity: "success",
          });
        } else {
          setNotification({
            open: true,
            message: response.message || "Error sending cost data",
            severity: "error",
          });
        }
      });

      // Show loading notification
      setNotification({
        open: true,
        message: "Sending cost data...",
        severity: "info",
      });
    } catch (error) {
      console.error("Error sending cost data:", error);
      setNotification({
        open: true,
        message: `Error sending cost data: ${
          error instanceof Error ? error.message : String(error)
        }`,
        severity: "error",
      });
    }
  }, [prepareCostData, sendMessage]);

  // Handle sending data when button is clicked
  const handleSendData = useCallback(() => {
    try {
      // Check if we have valid data before proceeding
      if (!metaFile || !metaFile.valid) {
        setNotification({
          open: true,
          message: "No valid cost data to send",
          severity: "error",
        });
        return;
      }

      // Check if we have a WebSocket connection
      if (!wsConnected) {
        setNotification({
          open: true,
          message: "WebSocket not connected. Please wait or refresh the page.",
          severity: "error",
        });
        return;
      }

      // Proceed with sending data
      sendCostDataToServer();

      // Also call the original onSendData to maintain existing functionality
      onSendData();
    } catch (error) {
      console.error("Error in handleSendData:", error);
      setNotification({
        open: true,
        message: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        severity: "error",
      });
    }
  }, [metaFile, wsConnected, sendCostDataToServer, onSendData]);

  return (
    <>
      <ListItem sx={{ mt: 4 }}>
        <ListItemIcon>
          <InsertDriveFileIcon color="primary" />
        </ListItemIcon>
        <div className="flex-grow">
          <Typography sx={{ color: "#666" }}>{metaFile.file.name}</Typography>
          <Typography variant="body2" sx={{ color: "#888" }} className="pb-2">
            {fileSize(metaFile.file.size || 0)}
          </Typography>
        </div>
        <ListItemIcon className="flex gap-6">
          <IconButton edge="end" onClick={onRemoveFile}>
            <DeleteIcon />
          </IconButton>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSendData}
            disabled={!metaFile.valid || !wsConnected}
          >
            Daten senden {!wsConnected && "(Connecting...)"}
          </Button>
        </ListItemIcon>
      </ListItem>

      <Divider sx={{ my: 2 }} />

      <Typography
        variant="h5"
        className="mb-4"
        sx={{ color: "#000", fontWeight: 500 }}
      >
        Kostenübersicht
      </Typography>

      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={() => setNotification({ ...notification, open: false })}
      >
        <Alert
          onClose={() => setNotification({ ...notification, open: false })}
          severity={notification.severity}
          sx={{ width: "100%" }}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default FileInfo;
