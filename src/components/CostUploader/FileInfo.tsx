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

  // Add a ref to track if we've already loaded
  const hasLoadedRef = useRef(false);

  // Function to send a message and register a response handler
  const sendMessage = useCallback(
    (
      message: Record<string, unknown>,
      responseHandler?: (response: Record<string, unknown>) => void
    ) => {
      if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
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
          } catch (error) {}
        };
      } catch (error) {
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
            } catch (error) {}
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
        elementCount: 182, // Updated to match MainPage.tsx total elements count
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
    } catch (e) {}

    // Cleanup
    return () => {
      // Optional: remove element on component unmount
      // document.body.removeChild(costCodesEl);
    };
  }, []);

  // Prepare cost data for sending to Kafka
  const prepareCostData = useCallback(() => {
    // More detailed validation
    if (!metaFile) {
      throw new Error("No metaFile available");
    }

    if (!metaFile.data) {
      throw new Error("No data in metaFile");
    }

    // Check if data is an array directly (from Excel)
    if (Array.isArray(metaFile.data)) {
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

            // Get area data from Kafka if available
            const areaData = ebkp ? getAreaData(ebkp) : null;

            // Use Kafka area data if available, otherwise use the value from Excel
            const area = areaData?.value || item.menge || 0;

            // Calculate cost using the area
            const cost = area * costUnit;

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
              area: area,
              // Include timestamp if available from Kafka
              timestamp: areaData?.timestamp || new Date().toISOString(),
            };
          }),
      };

      return costData;
    }
    // Check if data has a data property (nested structure)
    else if (metaFile.data.data && Array.isArray(metaFile.data.data)) {
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

            // Get area data from Kafka if available
            const areaData = ebkp ? getAreaData(ebkp) : null;

            // Use Kafka area data if available, otherwise use the value from Excel
            const area = areaData?.value || item.menge || 0;

            // Calculate cost using the area
            const cost = area * costUnit;

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
              area: area,
              // Include timestamp if available from Kafka
              timestamp: areaData?.timestamp || new Date().toISOString(),
            };
          }),
      };

      return costData;
    } else {
      throw new Error(
        "Invalid data structure: could not find a valid data array"
      );
    }
  }, [metaFile, getAreaData]);

  // Send cost data to the server
  const sendCostDataToServer = useCallback(async () => {
    if (!metaFile || !metaFile.data) {
      return;
    }

    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
      setNotification({
        open: true,
        message: "Cannot send data - WebSocket not connected",
        severity: "error",
      });
      return;
    }

    try {
      // Extract the actual data array from the metaFile
      const costData = Array.isArray(metaFile.data)
        ? metaFile.data
        : metaFile.data.data;

      // Flatten the data (get all items including children)
      const flattenItems = getAllItems(costData);

      // Enhance items with area data from Kafka when available
      const enhancedItems = flattenItems.map((item) => {
        if (item.ebkp) {
          const areaData = getAreaData(item.ebkp);
          if (areaData) {
            return {
              ...item,
              menge: areaData.value, // Update area with Kafka value
              area: areaData.value, // Also add as area property
              areaSource: "kafka",
              fromKafka: true, // Flag that this item was updated from Kafka
              kafkaTimestamp: areaData.timestamp,
              kafkaSource: areaData.source || "BIM",
              einheit: "m²", // Set unit to m² for Kafka data
            };
          }
        }
        return item;
      });

      // Format cost data for WebSocket message
      const costMessage = {
        type: "cost_data",
        data: {
          project: "excel-import",
          filename: metaFile.file.name,
          timestamp: new Date().toISOString(),
          data: enhancedItems,
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
      });

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
      setNotification({
        open: true,
        message: error.message || "Error sending cost data",
        severity: "error",
      });
    }
  }, [metaFile, onSendData, getAreaData]);

  // Helper function to dispatch mapping status events
  const dispatchMappingStatus = (isMapping: boolean, message?: string) => {
    const event = new CustomEvent("bim-mapping-status", {
      detail: { isMapping, message },
    });
    window.dispatchEvent(event);
  };

  // Update the requestCodeMatching function to emit events for loading state
  const requestCodeMatching = useCallback(() => {
    if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WebSocket not connected"));
    }

    // Dispatch event to signal mapping has started
    dispatchMappingStatus(true, "BIM Elemente werden zugeordnet...");

    return new Promise<any>((resolve, reject) => {
      try {
        // DEBUG: Extract eBKP codes from Excel data to help diagnose matching issues
        let excelCodes: string[] = [];
        if (metaFile && metaFile.data) {
          const costData = Array.isArray(metaFile.data)
            ? metaFile.data
            : metaFile.data.data;
          const allItems = getAllItems(costData);

          // Extract and normalize all eBKP codes
          excelCodes = allItems
            .filter((item) => item.ebkp)
            .map((item) => {
              const code = String(item.ebkp).trim();
              return code;
            });

          // Also show all eBKP codes after normalization to help with debugging
          const normalizedCodes = excelCodes.map((code) => {
            // Simple normalization helper function
            const normalize = (c: string): string => {
              if (!c) return c;

              // Convert to uppercase and trim whitespace
              const upperCode = c.toUpperCase().trim();

              // Remove spaces
              let normalized = upperCode.replace(/\s+/g, "");

              // Handle leading zeros in patterns like C01.01 -> C1.1
              normalized = normalized.replace(
                /([A-Z])0*(\d+)\.0*(\d+)/g,
                "$1$2.$3"
              );

              // Handle leading zeros in codes like C01 -> C1
              normalized = normalized.replace(/([A-Z])0*(\d+)$/g, "$1$2");

              // Handle special case "C.1" format (missing number after letter)
              normalized = normalized.replace(/([A-Z])\.(\d+)/g, "$1$2");

              return normalized;
            };

            const normalized = normalize(code);
            return normalized;
          });
        }

        // Create a unique message ID for this request
        const messageId =
          Date.now().toString() + Math.random().toString(36).substring(2, 10);

        // Register a response handler for this message ID
        responseHandlersRef.current[messageId] = (response) => {
          // Auto-add the matching codes to in-memory storage
          if (response.matchingCodes && response.matchingCodes.length > 0) {
            // Update the metaFile data with area values from matching codes
            if (metaFile && metaFile.data) {
              const costData = Array.isArray(metaFile.data)
                ? metaFile.data
                : metaFile.data.data;

              // Process all items to find matches and add area values
              const processItems = (items: CostItem[]) => {
                items.forEach((item) => {
                  if (item.ebkp) {
                    // Check if this code matches any in the response
                    const match = response.matchingCodes.find((mc) => {
                      const normalizedItemCode = normalize(item.ebkp);
                      return (
                        normalizedItemCode === mc.code ||
                        normalizedItemCode === mc.excelCode ||
                        normalizedItemCode === mc.normalizedExcelCode
                      );
                    });

                    if (match) {
                      // Use quantity from MongoDB
                      const quantity = match.quantity;

                      // Update item with area data
                      item.area = quantity || 0;
                      item.areaSource = "mongodb";
                      item.timestamp = response.timestamp;
                      item.einheit = "m²"; // Set unit to m² for MongoDB data
                    }
                  }

                  // Process children recursively
                  if (item.children && item.children.length > 0) {
                    processItems(item.children);
                  }
                });
              };

              // Simple normalization helper function
              const normalize = (c: string): string => {
                if (!c) return c;
                const upperCode = c.toUpperCase().trim();
                let normalized = upperCode.replace(/\s+/g, "");
                normalized = normalized.replace(
                  /([A-Z])0*(\d+)\.0*(\d+)/g,
                  "$1$2.$3"
                );
                normalized = normalized.replace(/([A-Z])0*(\d+)$/g, "$1$2");
                normalized = normalized.replace(/([A-Z])\.(\d+)/g, "$1$2");
                return normalized;
              };

              processItems(costData);

              // Dispatch event to signal mapping is complete
              setTimeout(() => {
                dispatchMappingStatus(false);
              }, 500); // Small delay to ensure UI updates
            }
          } else {
            // No matches found, still need to signal completion
            dispatchMappingStatus(false);
          }

          resolve(response);
        };

        // Set a timeout to reject the promise if no response is received
        setTimeout(() => {
          if (responseHandlersRef.current[messageId]) {
            delete responseHandlersRef.current[messageId];
            // Signal mapping has failed/completed
            dispatchMappingStatus(false);
            reject(new Error("Code matching request timed out"));
          }
        }, 10000);

        // Add preprocessed Excel codes - both original and normalized
        const normalizedExcelCodes = excelCodes.map((code) => {
          // Simple normalization helper function
          const normalize = (c: string): string => {
            if (!c) return c;
            const upperCode = c.toUpperCase().trim();
            let normalized = upperCode.replace(/\s+/g, "");
            normalized = normalized.replace(
              /([A-Z])0*(\d+)\.0*(\d+)/g,
              "$1$2.$3"
            );
            normalized = normalized.replace(/([A-Z])0*(\d+)$/g, "$1$2");
            normalized = normalized.replace(/([A-Z])\.(\d+)/g, "$1$2");
            return normalized;
          };

          return {
            original: code,
            normalized: normalize(code),
          };
        });

        // Send the request with debug data
        const message = {
          type: "request_code_matching",
          messageId,
          debug: {
            excelCodes,
            normalizedExcelCodes,
            totalExcelCodes: excelCodes.length,
            forceMongoDB: true, // Tell server to force MongoDB load
          },
          // Add the codes directly to the message for the server to process
          codes: excelCodes,
          normalizedCodes: normalizedExcelCodes.map((nc) => nc.normalized),
        };

        if (globalWs) {
          globalWs.send(JSON.stringify(message));
        }
      } catch (error) {
        // Signal mapping has failed/completed
        dispatchMappingStatus(false);
        reject(error);
      }
    });
  }, [globalWs, metaFile]);

  // Update the auto-loading effect
  useEffect(() => {
    // Don't run if there's no metaFile or WebSocket isn't connected
    if (
      !metaFile ||
      !metaFile.data ||
      !globalWs ||
      globalWs.readyState !== WebSocket.OPEN ||
      hasLoadedRef.current // Skip if we've already loaded
    ) {
      return;
    }

    // Mark as loaded and request code matching
    hasLoadedRef.current = true;
    requestCodeMatching().catch(() => {});
  }, [metaFile, requestCodeMatching]);

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
      setNotification({
        open: true,
        message: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        severity: "error",
      });
    }
  }, [metaFile, wsConnected, sendCostDataToServer, onSendData]);

  // Expose request code matching and send data functions for the PreviewModal
  const exposeFunctions = useCallback(() => {
    if (typeof window !== "undefined") {
      // Expose requestCodeMatching function
      (window as any).requestCodeMatching = requestCodeMatching;

      // Expose sendCostDataToServer function with simplified interface
      (window as any).sendCostDataToServer = async (costData: any) => {
        if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
          throw new Error("Cannot send data - WebSocket not connected");
        }

        try {
          // Enhance data with Kafka area values if they exist
          if (costData.data && Array.isArray(costData.data)) {
            costData.data = costData.data.map((item: any) => {
              if (item.ebkph) {
                const areaData = getAreaData(item.ebkph);
                if (areaData) {
                  return {
                    ...item,
                    area: areaData.value,
                    menge: areaData.value, // Update menge property with the Kafka area value
                    areaSource: "kafka",
                    fromKafka: true, // Flag that this item was updated from Kafka
                    kafkaTimestamp: areaData.timestamp,
                    kafkaSource: areaData.source || "BIM",
                    einheit: "m²", // Set unit to m² for Kafka data
                  };
                }
              }
              return item;
            });
          }

          // Generate a unique ID for this message
          const messageId = `cost_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 10)}`;

          // Format cost data for WebSocket message
          const costMessage = {
            type: "cost_data",
            messageId: messageId,
            data: costData,
          };

          // Create a promise that resolves when we get a response, with improved error handling
          const responsePromise = new Promise((resolve, reject) => {
            // Create handlers for message, close, and error events
            const messageHandler = (event: MessageEvent) => {
              try {
                const response = JSON.parse(event.data);
                // Check if this is the response for our message
                if (
                  response.type === "cost_data_response" &&
                  response.messageId === messageId
                ) {
                  // Clean up event listeners
                  globalWs.removeEventListener("message", messageHandler);
                  globalWs.removeEventListener("close", closeHandler);
                  globalWs.removeEventListener("error", errorHandler);

                  // Clear timeout
                  clearTimeout(timeoutId);

                  if (response.status === "success") {
                    resolve(response);
                  } else {
                    reject(
                      new Error(response.message || "Error sending cost data")
                    );
                  }
                }
              } catch (error) {
                // Ignore parse errors from other messages
              }
            };

            const closeHandler = () => {
              clearTimeout(timeoutId);
              globalWs.removeEventListener("message", messageHandler);
              globalWs.removeEventListener("error", errorHandler);
              reject(new Error("WebSocket connection closed unexpectedly"));
            };

            const errorHandler = (error: Event) => {
              clearTimeout(timeoutId);
              globalWs.removeEventListener("message", messageHandler);
              globalWs.removeEventListener("close", closeHandler);
              reject(new Error(`WebSocket error: ${error.toString()}`));
            };

            // Set up event listeners
            globalWs.addEventListener("message", messageHandler);
            globalWs.addEventListener("close", closeHandler);
            globalWs.addEventListener("error", errorHandler);

            // Set a timeout - 30 seconds should be enough
            const timeoutId = setTimeout(() => {
              globalWs.removeEventListener("message", messageHandler);
              globalWs.removeEventListener("close", closeHandler);
              globalWs.removeEventListener("error", errorHandler);
              reject(new Error("Response timeout after 30 seconds"));
            }, 30000);
          });

          // Send the message
          globalWs.send(JSON.stringify(costMessage));
          console.log("Cost data sent to server with messageId:", messageId);

          // Wait for the cost data to be processed
          const response = await responsePromise;
          console.log("Received success response:", response);

          // Return success immediately instead of waiting for reapply_costs
          return { success: true, message: "Cost data successfully sent" };
        } catch (error: any) {
          console.error("Error sending cost data:", error);
          throw error;
        }
      };
    }
  }, [requestCodeMatching, getAreaData]);

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
