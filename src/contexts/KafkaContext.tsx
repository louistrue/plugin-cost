import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { CostItem } from "../components/CostUploader/types";

// Enhanced area data type that includes timestamp
interface EbkpAreaData {
  value: number;
  timestamp: string;
  source?: string; // E.g., "IFC", "Revit", etc.
}

// Define the shape of our eBKP area map
interface EbkpAreaMap {
  [ebkpCode: string]: EbkpAreaData;
}

// Define the context shape
interface KafkaContextProps {
  ebkpAreaMap: EbkpAreaMap;
  replaceEbkpPlaceholders: (text: string) => string;
  calculateUpdatedChf: (item: CostItem) => number | null;
  calculateUpdatedTotalCost: (items: CostItem[]) => number;
  getAreaData: (ebkpCode: string) => EbkpAreaData | undefined;
  isKafkaData: (ebkpCode: string) => boolean;
  formatTimestamp: (timestamp: string) => string;
  ebkpAreaSums: { [key: string]: number };
}

// Create the context with default values
const KafkaContext = createContext<KafkaContextProps>({
  ebkpAreaMap: {},
  replaceEbkpPlaceholders: (text) => text,
  calculateUpdatedChf: () => null,
  calculateUpdatedTotalCost: () => 0,
  getAreaData: () => undefined,
  isKafkaData: () => false,
  formatTimestamp: () => "",
  ebkpAreaSums: {},
});

// Custom hook to use the Kafka context
export const useKafka = () => useContext(KafkaContext);

// Define the provider component props
interface KafkaProviderProps {
  children: ReactNode;
}

// Provider component that will wrap the app
export const KafkaProvider: React.FC<KafkaProviderProps> = ({ children }) => {
  const [ebkpAreaMap, setEbkpAreaMap] = useState<EbkpAreaMap>({});

  // Connect to WebSocket and listen for messages
  useEffect(() => {
    // URL for WebSocket connection
    const WEBSOCKET_URL =
      import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8001";

    const ws = new WebSocket(WEBSOCKET_URL);

    ws.onopen = () => {
      console.log("WebSocket connection established for KafkaContext");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Skip connection status messages
        if (data.type === "connection") return;

        // Process message and update area data
        if (data.ebkph && data.area !== undefined) {
          // Extract the EBKP code from ebkph string
          // Typically ebkph might contain a full hierarchical path like "B/B06/B06.01"
          const rawEbkpCode = data.ebkph.split("/").pop() || data.ebkph;

          // Normalize the eBKP code to handle format differences
          const normalizedEbkpCode = normalizeEbkpCode(rawEbkpCode);

          // Get the source from the filename or a default if not available
          const source = data.filename
            ? data.filename.includes("IFC") || data.filename.includes("ifc")
              ? "IFC"
              : data.filename.includes("Revit") || data.filename.includes("rvt")
              ? "Revit"
              : "BIM"
            : "BIM";

          setEbkpAreaMap((prev) => {
            const currentData = prev[normalizedEbkpCode];
            const currentValue = currentData?.value || 0;

            return {
              ...prev,
              [normalizedEbkpCode]: {
                value: currentValue + data.area,
                timestamp: new Date().toISOString(),
                source,
              },
            };
          });
        }
      } catch (err) {
        console.error("Error parsing WebSocket message:", err);
      }
    };

    ws.onerror = (event) => {
      console.error("WebSocket error:", event);
    };

    ws.onclose = (event) => {
      console.log("WebSocket connection closed", event.code, event.reason);
    };

    // Clean up on unmount
    return () => {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    };
  }, []);

  // Function to normalize eBKP codes, handling differences between Kafka and Excel formats
  const normalizeEbkpCode = (code: string): string => {
    if (!code) return code;

    // Convert code to uppercase for case-insensitive comparison
    const upperCode = code.toUpperCase();

    // Extract letter and number parts, removing leading zeros from numbers
    // Example: "C02.01" becomes "C2.1"
    return upperCode.replace(/([A-Z])0*(\d+)\.0*(\d+)/g, "$1$2.$3");
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp: string): string => {
    if (!timestamp) return "";
    try {
      const date = new Date(timestamp);
      return date.toLocaleString("de-CH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return timestamp;
    }
  };

  // Function to replace {{eBKP:X}} placeholders with actual values
  const replaceEbkpPlaceholders = (text: string): string => {
    if (!text) return text;

    // Use regex to find all {{eBKP:X}} placeholders
    return text.replace(/\{\{eBKP:([^}]+)\}\}/g, (match, ebkpCode) => {
      // Normalize the eBKP code from the placeholder
      const normalizedCode = normalizeEbkpCode(ebkpCode);

      const areaData = ebkpAreaMap[normalizedCode];
      if (areaData?.value !== undefined) {
        // Format the number with 2 decimal places
        return areaData.value.toLocaleString("de-CH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      }
      // Keep the placeholder if no value found
      return match;
    });
  };

  // Calculate CHF value based on Kafka area data when available
  const calculateUpdatedChf = (item: CostItem): number | null => {
    if (!item) return null;

    // If we have Kafka area data for this eBKP code
    if (item.ebkp) {
      // Normalize the eBKP code
      const normalizedCode = normalizeEbkpCode(item.ebkp);

      const areaData = ebkpAreaMap[normalizedCode];
      if (areaData?.value !== undefined) {
        const area = areaData.value;

        // If we have kennwert, calculate CHF = area * kennwert
        if (item.kennwert !== null && item.kennwert !== undefined) {
          return area * item.kennwert;
        }
      }
    }

    // If no Kafka data or kennwert, return original CHF value or null if undefined
    return item.chf ?? null;
  };

  // Calculate total cost based on Kafka area data when available
  const calculateUpdatedTotalCost = (items: CostItem[]): number => {
    if (!items || !items.length) return 0;

    const calculateItemAndChildren = (costItem: CostItem): number => {
      // Get updated CHF for this item based on Kafka area data
      const updatedChf = calculateUpdatedChf(costItem) || 0;

      // If the item has children, recursively calculate their CHF values too
      const childrenChf =
        costItem.children && costItem.children.length > 0
          ? costItem.children.reduce(
              (sum, child) => sum + calculateItemAndChildren(child),
              0
            )
          : 0;

      return updatedChf + childrenChf;
    };

    // Calculate total for all top-level items
    return items.reduce((sum, item) => sum + calculateItemAndChildren(item), 0);
  };

  // Helper methods for components
  const getAreaData = (ebkpCode: string): EbkpAreaData | undefined => {
    if (!ebkpCode) return undefined;
    const normalizedCode = normalizeEbkpCode(ebkpCode);
    return ebkpAreaMap[normalizedCode];
  };

  const isKafkaData = (ebkpCode: string): boolean => {
    if (!ebkpCode) return false;
    const normalizedCode = normalizeEbkpCode(ebkpCode);
    return ebkpAreaMap[normalizedCode] !== undefined;
  };

  // Create a utility function to get ebkpAreaSums for backwards compatibility
  const getEbkpAreaSums = (): { [key: string]: number } => {
    const result: { [key: string]: number } = {};

    for (const [key, data] of Object.entries(ebkpAreaMap)) {
      result[key] = data.value;
    }

    return result;
  };

  // For backwards compatibility
  const ebkpAreaSums = getEbkpAreaSums();

  // Provide the context value
  const contextValue: KafkaContextProps = {
    ebkpAreaMap,
    replaceEbkpPlaceholders,
    calculateUpdatedChf,
    calculateUpdatedTotalCost,
    getAreaData,
    isKafkaData,
    formatTimestamp,
    ebkpAreaSums,
  };

  return (
    <KafkaContext.Provider value={contextValue}>
      {children}
    </KafkaContext.Provider>
  );
};
