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
import SendIcon from "@mui/icons-material/Send";

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

  // Add cost codes to DOM for access by preview modal
  useEffect(() => {
    // Create or update a hidden div with cost codes data
    let costCodesEl = document.querySelector("[data-cost-codes]");

    if (!costCodesEl) {
      costCodesEl = document.createElement("div");
      costCodesEl.style.display = "none";
      document.body.appendChild(costCodesEl);
    }

    // Get cost codes from Kafka context if available
    try {
      const costCodes = [];

      // Try to extract codes from response store
      for (const key in window) {
        if (key.startsWith("_kafka_response_") && window[key]?.costCodes) {
          costCodes.push(...window[key].costCodes);
        }
      }

      // Store element info for preview modal
      window.__ELEMENT_INFO = {
        elementCount: 76, // Default or fetched from WebSocket response
        ebkphCodes: ["C2.1", "C3.1", "C4.1", "G2", "C2.2"], // Default or fetched codes
        projects: ["Current Project"],
        costCodes:
          costCodes.length > 0
            ? costCodes
            : ["C2.1", "C2.2", "C3.1", "C3.2", "C4.1", "C4.2", "C4.3"],
      };

      // Store in DOM element
      costCodesEl.setAttribute(
        "data-cost-codes",
        JSON.stringify(window.__ELEMENT_INFO.costCodes)
      );
    } catch (e) {
      console.error("Error storing cost codes in DOM", e);
    }

    // Cleanup
    return () => {
      // Optional: remove element on component unmount
      // document.body.removeChild(costCodesEl);
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
    if (!metaFile || !metaFile.data) {
      console.error("No file data to send");
      return;
    }

    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      setNotification({
        open: true,
        message: "Cannot send data - WebSocket not connected",
        severity: "error",
      });
      return;
    }

    try {
      console.log("Preparing to send cost data to server...");

      // Extract the actual data array from the metaFile
      const costData = Array.isArray(metaFile.data)
        ? metaFile.data
        : metaFile.data.data;

      // Flatten the data (get all items including children)
      const flattenItems = getAllItems(costData);
      console.log(`Sending ${flattenItems.length} cost items to server`);

      // Format cost data for WebSocket message
      const costMessage = {
        type: "cost_data",
        data: {
          project: "excel-import",
          filename: metaFile.file.name,
          timestamp: new Date().toISOString(),
          data: flattenItems,
          replaceExisting: true, // Replace existing cost data
        },
      };

      // Register a one-time handler for the response
      const messageId =
        Date.now().toString() + Math.random().toString(36).substring(2, 10);

      // Create a promise that resolves when we get a response
      const responsePromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          delete responseHandlersRef.current[messageId];
          reject(new Error("Response timeout"));
        }, 30000);

        responseHandlersRef.current[messageId] = (response) => {
          clearTimeout(timeoutId);

          if (response.status === "success") {
            resolve(response);
          } else {
            reject(new Error(response.message || "Error sending cost data"));
          }
        };
      });

      // Add message ID to the cost message
      costMessage.messageId = messageId;

      // Send the message
      globalWs.send(JSON.stringify(costMessage));
      console.log("Cost data sent to server");

      // Wait for the cost data to be processed
      await responsePromise;

      // Now send a reapply_costs message to process all elements with our new costs
      const reapplyMessage = {
        type: "reapply_costs",
        timestamp: new Date().toISOString(),
      };

      // Send the reapply message and wait for response
      const reapplyResponse = await new Promise((resolve, reject) => {
        const reapplyMessageId =
          Date.now().toString() + Math.random().toString(36).substring(2, 15);
        const timeoutId = setTimeout(() => {
          delete responseHandlersRef.current[reapplyMessageId];
          reject(new Error("Reapply response timeout"));
        }, 60000); // Allow more time for reapply

        responseHandlersRef.current[reapplyMessageId] = (response: any) => {
          clearTimeout(timeoutId);

          if (response.status === "success") {
            resolve(response);
          } else {
            reject(new Error(response.message || "Error reapplying costs"));
          }
        };

        reapplyMessage.messageId = reapplyMessageId;
        globalWs.send(JSON.stringify(reapplyMessage));
        console.log("Reapply costs request sent to server");
      });

      console.log("Cost data successfully processed and applied to elements");

      // Show success notification
      setNotification({
        open: true,
        message: "Cost data successfully sent and applied to BIM elements",
        severity: "success",
      });

      // Call external handler
      if (onSendData) {
        onSendData();
      }
    } catch (error) {
      console.error("Error sending cost data:", error);

      setNotification({
        open: true,
        message: error.message || "Error sending cost data",
        severity: "error",
      });
    }
  }, [metaFile, onSendData]);

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

  // Function to request code matching information from the server
  const requestCodeMatching = useCallback(() => {
    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected - can't request code matching");
      return Promise.reject(new Error("WebSocket not connected"));
    }

    return new Promise<any>((resolve, reject) => {
      try {
        // Create a unique message ID for this request
        const messageId =
          Date.now().toString() + Math.random().toString(36).substring(2, 10);

        // Register a response handler for this message ID
        responseHandlersRef.current[messageId] = (response) => {
          console.log("Received code matching response:", response);
          resolve(response);
        };

        // Set a timeout to reject the promise if no response is received
        setTimeout(() => {
          if (responseHandlersRef.current[messageId]) {
            delete responseHandlersRef.current[messageId];
            reject(new Error("Code matching request timed out"));
          }
        }, 10000);

        // Send the request
        const message = {
          type: "request_code_matching",
          messageId,
        };

        globalWs.send(JSON.stringify(message));
        console.log("Sent code matching request with ID:", messageId);
      } catch (error) {
        console.error("Error sending code matching request:", error);
        reject(error);
      }
    });
  }, []);

  // Expose request code matching and send data functions for the PreviewModal
  const exposeFunctions = useCallback(() => {
    if (typeof window !== "undefined") {
      // Expose requestCodeMatching function
      (window as any).requestCodeMatching = requestCodeMatching;

      // Expose sendCostDataToServer function with simplified interface
      (window as any).sendCostDataToServer = async (costData: any) => {
        if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
          console.error("WebSocket not connected");
          throw new Error("Cannot send data - WebSocket not connected");
        }

        try {
          console.log("Sending cost data to server:", costData);

          // Format cost data for WebSocket message
          const costMessage = {
            type: "cost_data",
            data: costData,
          };

          // Register a one-time handler for the response
          const messageId =
            Date.now().toString() + Math.random().toString(36).substring(2, 10);

          // Create a promise that resolves when we get a response
          const responsePromise = new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              delete responseHandlersRef.current[messageId];
              reject(new Error("Response timeout"));
            }, 30000);

            responseHandlersRef.current[messageId] = (response: any) => {
              clearTimeout(timeoutId);

              if (response.status === "success") {
                resolve(response);
              } else {
                reject(
                  new Error(response.message || "Error sending cost data")
                );
              }
            };
          });

          // Add message ID to the cost message
          (costMessage as any).messageId = messageId;

          // Send the message
          globalWs.send(JSON.stringify(costMessage));
          console.log("Cost data sent to server");

          // Wait for the cost data to be processed
          await responsePromise;

          // Now send a reapply_costs message to process all elements with our new costs
          const reapplyMessage = {
            type: "reapply_costs",
            timestamp: new Date().toISOString(),
          };

          // Send the reapply message and wait for response
          const reapplyResponse = await new Promise((resolve, reject) => {
            const reapplyMessageId =
              Date.now().toString() +
              Math.random().toString(36).substring(2, 15);
            const timeoutId = setTimeout(() => {
              delete responseHandlersRef.current[reapplyMessageId];
              reject(new Error("Reapply response timeout"));
            }, 60000); // Allow more time for reapply

            responseHandlersRef.current[reapplyMessageId] = (response: any) => {
              clearTimeout(timeoutId);

              if (response.status === "success") {
                resolve(response);
              } else {
                reject(new Error(response.message || "Error reapplying costs"));
              }
            };

            (reapplyMessage as any).messageId = reapplyMessageId;
            if (globalWs && globalWs.readyState === WebSocket.OPEN) {
              globalWs.send(JSON.stringify(reapplyMessage));
              console.log("Reapply costs request sent to server");
            } else {
              reject(new Error("WebSocket not connected"));
            }
          });

          console.log(
            "Cost data successfully processed and applied to elements"
          );

          // Return success
          return { success: true };
        } catch (error: any) {
          console.error("Error sending cost data:", error);
          throw error;
        }
      };
    }
  }, [requestCodeMatching]);

  // Call the expose function when the component mounts
  useEffect(() => {
    exposeFunctions();
  }, [exposeFunctions]);

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
