import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";
import { CostItem } from "../components/CostUploader/types";

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

// Project update type
interface ProjectUpdate {
  projectId: string;
  projectName: string;
  elementCount: number;
  totalCost?: number;
  timestamp: string;
}

// Add a new interface for eBKP codes
interface EbkpCodeInfo {
  code: string;
  type?: string;
  description?: string;
}

// Add types for cached project data
interface ProjectElement {
  id: string;
  ebkpCode: string;
  quantity: number;
  area: number;
  description?: string;
  category?: string;
  level?: string;
}

interface ProjectData {
  elements: ProjectElement[];
  ebkpMap: Record<string, ProjectElement[]>;
  lastFetched: number;
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
  mongoGetElements: (projectId: string) => Promise<MongoElement[]>;
  mongoProjectCost: (projectId: string) => Promise<number>;
  sendMessage: (message: string) => void;
  registerMessageHandler: (
    messageId: string,
    handler: (data: Record<string, unknown>) => void
  ) => void;
  availableEbkpCodes: EbkpCodeInfo[];
  matchCodes: (codes: string[]) => EbkpCodeInfo[];
  getProjectElements: (projectName: string) => Promise<ProjectElement[]>;
  getElementsForEbkp: (
    projectName: string,
    ebkpCode: string
  ) => Promise<ProjectElement[]>;
  getCachedProjectData: (projectName: string) => ProjectData | null;
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
  mongoGetElements: () => Promise.resolve([]),
  mongoProjectCost: () => Promise.resolve(0),
  sendMessage: () => {},
  registerMessageHandler: () => {},
  availableEbkpCodes: [],
  matchCodes: () => [],
  getProjectElements: () => Promise.resolve([]),
  getElementsForEbkp: () => Promise.resolve([]),
  getCachedProjectData: () => null,
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
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [availableEbkpCodes, setAvailableEbkpCodes] = useState<EbkpCodeInfo[]>(
    []
  );

  // Add state for project elements cache
  const [projectDataCache, setProjectDataCache] = useState<
    Record<string, ProjectData>
  >({});

  // Message response handlers - store callbacks for messages with specific messageIds
  const [messageHandlers] = useState<
    Record<string, (data: Record<string, unknown>) => void>
  >({});

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
      const timeoutId = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.OPEN) {
          console.warn("WebSocket connection timeout in KafkaContext");
          if (ws) ws.close();
          setConnectionStatus("DISCONNECTED");
        }
      }, 5000);

      // Initialize WebSocket
      ws = new WebSocket(wsUrl);
      setWebsocket(ws);

      ws.onopen = () => {
        console.log("WebSocket connection established for KafkaContext");
        clearTimeout(timeoutId);
        setConnectionStatus("CONNECTED");

        // Request available eBKP codes after connection is established
        requestAvailableEbkpCodes(ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>;

          // Handle receiving eBKP codes list from server
          if (
            data.type === "available_ebkp_codes" &&
            Array.isArray(data.codes)
          ) {
            console.log(
              "Received available eBKP codes from server:",
              data.codes
            );

            // Transform the codes into our EbkpCodeInfo format
            const codeObjects: EbkpCodeInfo[] = data.codes.map(
              (code: string) => ({
                code,
                type: code.split(".")[0], // Extract main type like C1, C2, etc.
              })
            );

            setAvailableEbkpCodes(codeObjects);
            return;
          }

          // Check if this message has a messageId that has a registered handler
          if (
            typeof data.messageId === "string" &&
            messageHandlers[data.messageId]
          ) {
            // Call the registered handler for this message ID
            messageHandlers[data.messageId](data);
            // Clean up the handler after use
            delete messageHandlers[data.messageId];
            return;
          }

          // Skip connection status messages
          if (data.type === "connection") {
            // Update connection status if included in the message
            if (typeof data.kafka === "string") {
              setConnectionStatus(data.kafka);
            }
            return;
          }

          // Handle project update notifications
          if (
            data.type === "project_update" &&
            typeof data.projectName === "string" &&
            typeof data.projectId === "string" &&
            typeof data.totalElements === "number" &&
            typeof data.timestamp === "string"
          ) {
            console.log(
              "KafkaContext: Received project update notification:",
              data
            );

            // Store project update information
            setProjectUpdates((prev) => ({
              ...prev,
              [data.projectName as string]: {
                projectId: data.projectId as string,
                projectName: data.projectName as string,
                elementCount: data.totalElements as number,
                totalCost:
                  typeof data.totalCost === "number"
                    ? data.totalCost
                    : undefined,
                timestamp: data.timestamp as string,
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
        clearTimeout(timeoutId);
        if (ws) {
          ws.close();
        }
      };
    } catch (error) {
      console.error("Failed to initialize WebSocket in KafkaContext:", error);
      setConnectionStatus("DISCONNECTED");
      return () => {}; // Empty cleanup function
    }
  }, [messageHandlers]); // Add messageHandlers as a dependency

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
      console.error("Error formatting timestamp:", error);
      return timestamp;
    }
  };

  // Function to send a message via WebSocket
  const sendMessage = (message: string): void => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      console.error("Cannot send message: WebSocket is not connected");
      throw new Error("WebSocket is not connected");
    }

    try {
      websocket.send(message);

      // Check if the message has a messageId
      const parsedMessage = JSON.parse(message);
      if (parsedMessage.messageId) {
        console.log(`Sent message with ID: ${parsedMessage.messageId}`);
      }
    } catch (error) {
      console.error("Error sending WebSocket message:", error);
      throw error;
    }
  };

  // Function to register a message handler for a specific messageId
  const registerMessageHandler = (
    messageId: string,
    handler: (data: Record<string, unknown>) => void
  ): void => {
    messageHandlers[messageId] = handler;
    console.log(`Registered handler for message ID: ${messageId}`);
  };

  // Function to request available eBKP codes from the server
  const requestAvailableEbkpCodes = (ws: WebSocket | null) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error("Cannot request eBKP codes: WebSocket is not connected");
      return;
    }

    try {
      const message = {
        type: "get_available_ebkp_codes",
        timestamp: new Date().toISOString(),
        messageId: `ebkp_codes_${Date.now()}`,
      };
      ws.send(JSON.stringify(message));
      console.log("Requested available eBKP codes from server");
    } catch (error) {
      console.error("Error requesting eBKP codes:", error);
    }
  };

  // Function to match codes with available eBKP codes
  const matchCodes = (codes: string[]): EbkpCodeInfo[] => {
    if (!codes || !codes.length || !availableEbkpCodes.length) {
      return [];
    }

    // Normalize input codes
    const normalizedCodes = codes.map((code) => normalizeCode(code));

    // Find matching codes from available codes
    const matches = availableEbkpCodes.filter((codeInfo) =>
      normalizedCodes.some((code) => code === codeInfo.code)
    );

    console.log(`Matched ${matches.length} out of ${codes.length} codes`);
    return matches;
  };

  // Helper function to normalize a code (similar to backend)
  const normalizeCode = (code: string): string => {
    // Remove whitespace, convert to uppercase
    return code.trim().toUpperCase();
  };

  // Function to fetch and cache project elements
  const fetchProjectElements = useCallback(
    async (projectName: string): Promise<ProjectElement[]> => {
      if (!backendUrl) {
        console.error(
          "Cannot fetch project elements: Backend URL not available"
        );
        return [];
      }

      // Check if we have cached data that's less than 5 minutes old
      const cachedData = projectDataCache[projectName];
      const now = Date.now();
      if (cachedData && now - cachedData.lastFetched < 5 * 60 * 1000) {
        console.log(`Using cached project data for ${projectName}`);
        return cachedData.elements;
      }

      try {
        console.log(`Fetching elements for project: ${projectName}`);
        const response = await fetch(
          `${backendUrl}/project-elements/${encodeURIComponent(projectName)}`
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch project elements: ${response.status} ${response.statusText}`
          );
        }

        const elements = await response.json();
        console.log(
          `Received ${elements.length} elements for project ${projectName}`
        );

        // Transform to our simplified structure
        const transformedElements: ProjectElement[] = elements
          .map((element: Record<string, unknown>) => {
            // Extract eBKP code from various possible locations
            const properties = element.properties as
              | Record<string, unknown>
              | undefined;
            const ebkpCode =
              (properties?.classification as { id?: string })?.id ||
              (properties?.ebkph as string) ||
              (element.ebkph as string) ||
              (element.ebkp_code as string) ||
              (element.ebkp as string) ||
              "";

            // Extract quantity/area
            const quantity = parseFloat(
              (
                (element.quantity as string) ||
                (element.area as string) ||
                0
              ).toString()
            );

            return {
              id: (element._id as string) || (element.id as string) || "",
              ebkpCode: ebkpCode.toUpperCase().trim(),
              quantity: quantity,
              area: quantity, // Use same value for area
              description: properties?.description || "",
              category:
                (element.category as string) || properties?.category || "",
              level: (element.level as string) || properties?.level || "",
            };
          })
          .filter((e: ProjectElement) => e.ebkpCode && e.ebkpCode !== "");

        // Build a map for quick access by eBKP code
        const ebkpMap: Record<string, ProjectElement[]> = {};
        transformedElements.forEach((element) => {
          const normalizedCode = normalizeEbkpCode(element.ebkpCode);
          if (!ebkpMap[normalizedCode]) {
            ebkpMap[normalizedCode] = [];
          }
          ebkpMap[normalizedCode].push(element);
        });

        // Store in cache
        const projectData: ProjectData = {
          elements: transformedElements,
          ebkpMap,
          lastFetched: now,
        };

        setProjectDataCache((prev) => ({
          ...prev,
          [projectName]: projectData,
        }));

        console.log(
          `Cached ${transformedElements.length} elements for project ${projectName}`
        );
        return transformedElements;
      } catch (error) {
        console.error(
          `Error fetching project elements: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return [];
      }
    },
    [backendUrl, projectDataCache]
  );

  // Function to get elements for a specific eBKP code
  const getElementsForEbkp = useCallback(
    async (
      projectName: string,
      ebkpCode: string
    ): Promise<ProjectElement[]> => {
      // Normalize the eBKP code for consistency
      const normalizedCode = normalizeEbkpCode(ebkpCode);

      // Ensure we have cached data
      let cachedData = projectDataCache[projectName];
      if (!cachedData) {
        await fetchProjectElements(projectName);
        cachedData = projectDataCache[projectName];
      }

      if (!cachedData) {
        return [];
      }

      // Return elements with the matching code
      return cachedData.ebkpMap[normalizedCode] || [];
    },
    [fetchProjectElements, projectDataCache]
  );

  // Helper function to normalize eBKP codes
  const normalizeEbkpCode = (code: string): string => {
    if (!code) return "";

    // Convert to uppercase and trim
    const upperCode = code.toUpperCase().trim();

    // Remove spaces
    let normalized = upperCode.replace(/\s+/g, "");

    // Normalize format: C01.01 -> C1.1
    normalized = normalized.replace(/([A-Z])0*(\d+)\.0*(\d+)/g, "$1$2.$3");

    // Normalize format without dots: C01 -> C1
    normalized = normalized.replace(/([A-Z])0*(\d+)$/g, "$1$2");

    // Handle case with missing number: C.1 -> C1
    normalized = normalized.replace(/([A-Z])\.(\d+)/g, "$1$2");

    return normalized;
  };

  // Function to get all project elements
  const getProjectElements = useCallback(
    async (projectName: string): Promise<ProjectElement[]> => {
      return await fetchProjectElements(projectName);
    },
    [fetchProjectElements]
  );

  // Function to get cached project data
  const getCachedProjectData = useCallback(
    (projectName: string): ProjectData | null => {
      return projectDataCache[projectName] || null;
    },
    [projectDataCache]
  );

  return (
    <KafkaContext.Provider
      value={{
        connectionStatus,
        sendCostUpdate,
        projectUpdates,
        replaceEbkpPlaceholders,
        calculateUpdatedChf,
        getAreaData: () => null,
        formatTimestamp,
        mongoGetElements: () => Promise.resolve([]),
        mongoProjectCost: () => Promise.resolve(0),
        sendMessage,
        registerMessageHandler,
        availableEbkpCodes,
        matchCodes,
        getProjectElements,
        getElementsForEbkp,
        getCachedProjectData,
      }}
    >
      {children}
    </KafkaContext.Provider>
  );
};
