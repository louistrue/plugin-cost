import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

// Project update type
interface ProjectUpdate {
  projectId: string;
  projectName: string;
  elementCount: number;
  totalCost?: number;
  timestamp: string;
}

// Define the context shape
interface KafkaContextProps {
  connectionStatus: string;
  sendCostUpdate: (
    projectId: string,
    projectName: string,
    totalCost: number,
    elementsWithCost: number
  ) => Promise<boolean>;
  projectUpdates: Record<string, ProjectUpdate>;
  replaceEbkpPlaceholders: (text: string) => string;
  calculateUpdatedChf: (item: CostItem) => number;
  getAreaData: (code: string) => {
    value?: number;
    count?: number;
    timestamp?: string;
    source?: string;
  } | null;
  formatTimestamp: (timestamp: string) => string;
}

// Create the context with default values
const KafkaContext = createContext<KafkaContextProps>({
  connectionStatus: "CONNECTING",
  sendCostUpdate: () => Promise.resolve(false),
  projectUpdates: {},
  replaceEbkpPlaceholders: (text: string) => text,
  calculateUpdatedChf: () => 0,
  getAreaData: () => null,
  formatTimestamp: (timestamp: string) => timestamp,
});

// Custom hook to use the Kafka context
export const useKafka = () => useContext(KafkaContext);

// Define the provider component props
interface KafkaProviderProps {
  children: ReactNode;
}

// Provider component that will wrap the app
export const KafkaProvider: React.FC<KafkaProviderProps> = ({ children }) => {
  const [backendUrl, setBackendUrl] = useState<string>("");
  const [projectUpdates, setProjectUpdates] = useState<
    Record<string, ProjectUpdate>
  >({});
  const [connectionStatus, setConnectionStatus] =
    useState<string>("CONNECTING");

  // Connect to WebSocket and listen for messages
  useEffect(() => {
    // Check if WebSocket is supported
    if (!("WebSocket" in window)) {
      console.error("WebSockets are not supported in this browser");
      setConnectionStatus("DISCONNECTED");
      return;
    }

    // URL for WebSocket connection
    let wsUrl = "ws://localhost:8001";
    try {
      if (import.meta.env && import.meta.env.VITE_WEBSOCKET_URL) {
        wsUrl = import.meta.env.VITE_WEBSOCKET_URL;
      }
    } catch (error) {
      console.warn("Error accessing environment variables:", error);
    }

    // Extract the HTTP URL from WebSocket URL for REST API calls
    try {
      const wsProtocol = wsUrl.startsWith("wss:") ? "https:" : "http:";
      const httpUrl = wsUrl.replace(/^ws(s)?:\/\//, "");
      const apiBaseUrl = `${wsProtocol}//${httpUrl}`;
      setBackendUrl(apiBaseUrl);
    } catch (error) {
      console.error("Error setting backend URL:", error);
      setBackendUrl("");
    }

    let ws: WebSocket | null = null;

    try {
      // Set up connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.OPEN) {
          console.warn("WebSocket connection timeout in KafkaContext");
          if (ws) ws.close();
          setConnectionStatus("DISCONNECTED");
        }
      }, 5000);

      // Initialize WebSocket
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("WebSocket connection established for KafkaContext");
        setConnectionStatus("CONNECTED");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Skip connection status messages
          if (data.type === "connection") {
            // Update connection status if included in the message
            if (data.kafka) {
              setConnectionStatus(data.kafka);
            }
            return;
          }

          // Handle project update notifications
          if (data.type === "project_update") {
            console.log(
              "KafkaContext: Received project update notification:",
              data
            );

            // Store project update information
            setProjectUpdates((prev) => ({
              ...prev,
              [data.projectName]: {
                projectId: data.projectId,
                projectName: data.projectName,
                elementCount: data.totalElements,
                totalCost: data.totalCost,
                timestamp: data.timestamp,
              },
            }));

            return;
          }
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };

      ws.onerror = (event) => {
        console.error("WebSocket error in KafkaContext:", event);
        setConnectionStatus("DISCONNECTED");
      };

      ws.onclose = (event) => {
        console.log(
          `WebSocket connection closed in KafkaContext: code=${
            event.code
          }, reason=${event.reason || "No reason"}`
        );
        setConnectionStatus("DISCONNECTED");
      };

      // Clean up on unmount
      return () => {
        if (ws) {
          ws.close();
        }
      };
    } catch (error) {
      console.error("Failed to initialize WebSocket in KafkaContext:", error);
      setConnectionStatus("DISCONNECTED");
      return () => {}; // Empty cleanup function
    }
  }, []);

  // Send cost update to Kafka via WebSocket server
  const sendCostUpdate = async (
    projectId: string,
    projectName: string,
    totalCost: number,
    elementsWithCost: number
  ): Promise<boolean> => {
    if (!backendUrl) {
      console.warn("Backend URL not available for API calls");
      return false;
    }

    try {
      // Create notification payload similar to qto_producer.py
      const notification = {
        eventType: "COST_UPDATED",
        timestamp: new Date().toISOString(),
        producer: "plugin-cost",
        payload: {
          projectId: projectId,
          projectName: projectName,
          elementCount: elementsWithCost,
          totalCost: totalCost,
        },
        metadata: {
          version: "1.0",
          correlationId: `cost-update-${Date.now()}`,
        },
      };

      // Send to WebSocket server
      const response = await fetch(`${backendUrl}/send-cost-update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(notification),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to send cost update: ${response.status} ${response.statusText}`
        );
      }

      return true;
    } catch (error) {
      console.error(
        `Error sending cost update for project ${projectId}:`,
        error
      );
      return false;
    }
  };

  // Function to replace eBKP placeholders in text
  const replaceEbkpPlaceholders = (text: string): string => {
    if (!text) return text;
    return text.replace(/\{ebkp\}/g, "eBKP");
  };

  // Function to calculate updated CHF value
  const calculateUpdatedChf = (item: CostItem): number => {
    if (!item.menge || !item.kennwert) return 0;
    return item.menge * item.kennwert;
  };

  // Function to get area data for a code
  const getAreaData = (
    code: string
  ): {
    value?: number;
    count?: number;
    timestamp?: string;
    source?: string;
  } | null => {
    // Since we're not using Kafka for element data anymore, return null
    return null;
  };

  // Function to format timestamp
  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return timestamp;
    }
  };

  return (
    <KafkaContext.Provider
      value={{
        connectionStatus,
        sendCostUpdate,
        projectUpdates,
        replaceEbkpPlaceholders,
        calculateUpdatedChf,
        getAreaData,
        formatTimestamp,
      }}
    >
      {children}
    </KafkaContext.Provider>
  );
};
