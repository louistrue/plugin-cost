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
import SendIcon from "@mui/icons-material/Send";

// Define structure for cost codes
interface CostCode {
  code: string;
  type: string;
}

// Define structure for Kafka-like responses on window
interface KafkaResponse {
  costCodes: CostCode[];
}

// Define structure for Element Info on window
interface ElementInfo {
  project: string;
  filename: string;
  timestamp: string;
  costCodes: CostCode[];
}

// Augment the global Window interface
declare global {
  interface Window {
    [key: string]: unknown; // Use unknown instead of any for better type safety
    __ELEMENT_INFO?: ElementInfo;
    _kafka_response_matchingCodes?: KafkaResponse;
    // You might want to add more specific keys if they are known
  }
}

// Helper function to get all items from a hierarchical structure
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

  const [wsConnected, setWsConnected] = useState(globalWsConnected);
  const responseHandlersRef = useRef<{
    [key: string]: (response: Record<string, unknown>) => void;
  }>({});

  // Add a ref to track if we've already loaded
  const hasLoadedRef = useRef(false);

  // Function to request re-application of cost data on the server
  const requestReapplyCostData = useCallback(async () => {
    if (!wsConnected) {
      setNotification({
        open: true,
        message: "Cannot request reapply: Not connected.",
        severity: "warning",
      });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const reapplyMessageId =
        "reapply_" +
        Date.now().toString() +
        Math.random().toString(36).substring(2, 10);

      // Define interface for payload
      interface ReapplyMessagePayload {
        type: string;
        timestamp: string;
        messageId?: string; // Add optional messageId
      }

      // const reapplyMessage: any = { // Use interface
      const reapplyMessage: ReapplyMessagePayload = {
        type: "reapply_costs",
        timestamp: new Date().toISOString(),
      };

      responseHandlersRef.current[reapplyMessageId] = (response) => {
        if (response.status === "success") {
          setNotification({
            open: true,
            message: "Server re-applied cost data.",
            severity: "success",
          });
          resolve();
        } else {
          setNotification({
            open: true,
            message: "Error requesting re-apply.",
            severity: "error",
          });
          reject(new Error("Re-apply request failed"));
        }
      };

      // Add messageId
      reapplyMessage.messageId = reapplyMessageId;
      if (globalWs && globalWs.readyState === WebSocket.OPEN) {
        try {
          globalWs.send(JSON.stringify(reapplyMessage));
        } catch (error) {
          delete responseHandlersRef.current[reapplyMessageId];
          reject(error);
        }
      } else {
        delete responseHandlersRef.current[reapplyMessageId];
        reject(new Error("WebSocket not connected for reapply"));
      }
    }).catch((error) => {
      setNotification({
        open: true,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error sending re-apply request",
        severity: "error",
      });
    });
  }, [wsConnected]);

  // Function to request matching codes from the server
  const requestCodeMatching = useCallback(async () => {
    if (!wsConnected || !metaFile || !metaFile.data) {
      console.warn("Cannot request matching: Not connected or no data.");
      return;
    }

    // Handle metaFile.data union type
    const itemsToProcess = Array.isArray(metaFile.data)
      ? metaFile.data
      : metaFile.data.data;

    // const allItems = getAllItems(metaFile.data); // Error TS2345
    const allItems = getAllItems(itemsToProcess);
    const excelCodes = allItems
      .map((item) => item.ebkp)
      .filter(
        (code): code is string => typeof code === "string" && code !== ""
      );

    excelCodes.map((code) => {
      // Basic normalization: lowercase and remove leading/trailing spaces
      return code.toLowerCase().trim();
    });

    return new Promise<void>((resolve, reject) => {
      const messageId =
        "match_" +
        Date.now().toString() +
        Math.random().toString(36).substring(2, 10);

      const message = {
        type: "request_code_matching",
        messageId,
        codes: excelCodes,
      };

      responseHandlersRef.current[messageId] = (response: unknown) => {
        // Type guard for response structure
        if (
          typeof response !== "object" ||
          response === null ||
          !("status" in response)
        ) {
          setNotification({
            open: true,
            message: "Invalid response received for code matching.",
            severity: "error",
          });
          reject(new Error("Invalid response"));
          return;
        }

        if (response.status === "success") {
          console.log("Received matching codes:", response);

          if (
            "matchingCodes" in response &&
            Array.isArray(response.matchingCodes) &&
            response.matchingCodes.length > 0
          ) {
            // Store matching codes globally using the augmented Window interface
            window._kafka_response_matchingCodes = {
              // Fixed any cast
              costCodes: response.matchingCodes,
            };

            setNotification({
              open: true,
              message: `Found ${response.matchingCodes.length} matching codes. Re-applying...`,
              severity: "info",
            });

            // Automatically trigger re-apply after receiving matches
            setTimeout(() => {
              requestReapplyCostData().catch(() => {});
            }, 500);
          } else {
            setNotification({
              open: true,
              message: "No matching codes found on server.",
              severity: "info",
            });
          }
          resolve();
        } else {
          setNotification({
            open: true,
            message: "Error requesting code matching.",
            severity: "error",
          });
          reject(new Error("Code matching request failed"));
        }
      };

      if (globalWs && globalWs.readyState === WebSocket.OPEN) {
        try {
          globalWs.send(JSON.stringify(message));
        } catch (error) {
          delete responseHandlersRef.current[messageId];
          reject(error);
        }
      } else {
        delete responseHandlersRef.current[messageId];
        reject(new Error("WebSocket not connected"));
      }
    });
  }, [wsConnected, metaFile, requestReapplyCostData]); // requestReapplyCostData is now defined above

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
        setWsConnected(globalWsConnected);
        return;
      }

      const wsUrl = import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8001";

      // Create new WebSocket connection
      try {
        const ws = new WebSocket(wsUrl);
        globalWs = ws;

        ws.onopen = () => {
          globalWsConnected = true;
          setWsConnected(true);
          reconnectAttempts = 0; // Reset reconnect counter on successful connection

          // Only request code matching on initial connection if we haven't loaded yet
          if (metaFile && metaFile.data && !hasLoadedRef.current) {
            setTimeout(() => {
              requestCodeMatching().catch(() => {});
            }, 1000);
          }
        };

        ws.onclose = (event) => {
          globalWsConnected = false;
          setWsConnected(false);
          globalWs = null;

          // Don't attempt to reconnect if the closure was intentional (code 1000)
          if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(
              1000 * Math.pow(2, reconnectAttempts),
              10000
            );

            reconnectTimeout = setTimeout(() => {
              reconnectAttempts++;
              connectWebSocket();
            }, delay);
          } else if (reconnectAttempts >= maxReconnectAttempts) {
            setNotification({
              open: true,
              message:
                "Failed to connect to server after multiple attempts. Please refresh the page.",
              severity: "error",
            });
          }
        };

        ws.onerror = () => {};

        // Message handler for WebSocket
        ws.onmessage = (event) => {
          try {
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
            }
          } catch (error) {
            console.error("Error parsing WebSocket message:", error);
          }
        };
      } catch (error) {
        console.error("Error initializing WebSocket:", error);
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

    if (globalClientCount === 1) {
      // Initial connection if this is the first client
      connectWebSocket();

      // Set up a ping interval to keep the connection alive
      if (!pingInterval) {
        pingInterval = setInterval(() => {
          if (globalWs && globalWs.readyState === WebSocket.OPEN) {
            try {
              globalWs.send(JSON.stringify({ type: "ping" }));
            } catch (error) {
              console.error("Failed to send ping:", error);
            }
          } else if (!globalWs || globalWs.readyState === WebSocket.CLOSED) {
            // If the connection is closed, try to reconnect
            if (reconnectAttempts < maxReconnectAttempts) {
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

      // If this is the last client, clean up shared resources
      if (globalClientCount === 0) {
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
          globalWs.close(1000, "Last component unmounting");
          globalWs = null;
          globalWsConnected = false;
        }
      }
    };
  }, [requestCodeMatching, metaFile]); // Add requestCodeMatching dependency

  // Add cost codes to DOM for access by preview modal
  useEffect(() => {
    // Create or update a hidden div with cost codes data
    let costCodesEl = document.querySelector("#cost-codes-data");

    if (!costCodesEl) {
      costCodesEl = document.createElement("div");
      costCodesEl.id = "cost-codes-data";
      (costCodesEl as HTMLElement).style.display = "none";
      document.body.appendChild(costCodesEl);
    }

    // Get cost codes from Kafka context if available
    try {
      // Check for existing cost codes from other plugins/sources
      const existingCostCodes: CostCode[] = [];
      Object.keys(window).forEach((key) => {
        if (key.startsWith("_kafka_response_")) {
          const potentialResponse = window[key] as Partial<KafkaResponse>; // Type assertion
          if (
            potentialResponse?.costCodes &&
            Array.isArray(potentialResponse.costCodes)
          ) {
            existingCostCodes.push(...potentialResponse.costCodes);
          }
        }
      });

      // Store element info globally using the augmented Window interface
      window.__ELEMENT_INFO = {
        // Fixed any cast
        project: metaFile.file.name,
        filename: metaFile.file.name,
        timestamp: new Date().toISOString(),
        // Use existing codes if available, otherwise empty
        costCodes: existingCostCodes.length > 0 ? existingCostCodes : [],
      };

      console.log(
        "Element info stored:",
        JSON.stringify(window.__ELEMENT_INFO.costCodes) // Fixed any cast
      );

      costCodesEl.setAttribute(
        "data-cost-codes",
        JSON.stringify(window.__ELEMENT_INFO.costCodes) // Fixed any cast
      );
    } catch (_e) {
      // Fixed unused variable (keep underscore prefix)
      console.error("Error processing cost codes from window:", _e); // Log error
    }

    // Cleanup
    return () => {
      // Optional: remove element on component unmount
      // document.body.removeChild(costCodesEl);
    };
  }, [metaFile]);

  // Code Matching Logic (Example Integration)
  useEffect(() => {
    if (
      wsConnected &&
      metaFile &&
      metaFile.data &&
      // metaFile.data.length > 0 && // Error TS2339
      (Array.isArray(metaFile.data)
        ? metaFile.data.length > 0
        : metaFile.data.data.length > 0) && // Check length based on type
      !hasLoadedRef.current
    ) {
      const dispatchMappingStatus = (isMapping: boolean, message?: string) => {
        const event = new CustomEvent("mappingStatusUpdate", {
          detail: { isMapping, message },
        });
        document.dispatchEvent(event);
      };

      const performMatching = async () => {
        dispatchMappingStatus(true, "Checking for code matches...");
        try {
          // Fetch matching codes from server
          await requestCodeMatching();
          dispatchMappingStatus(false);
        } catch (error) {
          console.error("Code matching failed:", error);
          dispatchMappingStatus(false, "Code matching failed.");
        }
      };

      // Only run matching once per file load
      hasLoadedRef.current = true;
      performMatching();
    }
  }, [wsConnected, metaFile, requestCodeMatching]);

  const handleCloseNotification = (
    _event?: React.SyntheticEvent | Event,
    reason?: string
  ) => {
    if (reason === "clickaway") {
      return;
    }
    setNotification({ ...notification, open: false });
  };

  // Effect to manage WebSocket event listeners based on wsConnected state
  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      try {
        const response = JSON.parse(event.data);
        if (
          response.messageId &&
          responseHandlersRef.current[response.messageId]
        ) {
          responseHandlersRef.current[response.messageId](response);
          delete responseHandlersRef.current[response.messageId];
        }
      } catch (error) {
        console.warn("Failed to parse WebSocket message:", error);
      }
    };

    const closeHandler = () => {
      setWsConnected(false);
      globalWsConnected = false;
      // Reconnection logic is handled within the connectWebSocket function
    };

    const errorHandler = (error: Event) => {
      console.error("Global WebSocket Error:", error);
      setWsConnected(false);
      globalWsConnected = false;
      // Consider showing an error notification here
    };

    if (wsConnected && globalWs) {
      // Remove potentially old listeners before adding new ones
      // It's generally safer to ensure listeners aren't duplicated
      if (globalWs) {
        globalWs.removeEventListener("message", messageHandler);
        globalWs.removeEventListener("close", closeHandler);
        globalWs.removeEventListener("error", errorHandler);
      }

      if (globalWs) {
        globalWs.addEventListener("message", messageHandler);
        globalWs.addEventListener("close", closeHandler);
        globalWs.addEventListener("error", errorHandler);
      }
    }

    // Cleanup listeners on unmount or when wsConnected becomes false
    return () => {
      if (globalWs) {
        globalWs.removeEventListener("message", messageHandler);
        globalWs.removeEventListener("close", closeHandler);
        globalWs.removeEventListener("error", errorHandler);
      }
    };
  }, [wsConnected]);

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
            sx={{ minWidth: "180px" }}
            onClick={onSendData}
            startIcon={<SendIcon />}
          >
            Vorschau anzeigen
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
        onClose={handleCloseNotification}
      >
        <Alert
          onClose={handleCloseNotification}
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
