import { CostItem } from "./CostUploader/types";
// import { EnhancedCostItem } from "./CostUploader/types"; // Don't import

// Define EnhancedCostItem directly here to avoid import issues
interface EnhancedCostItem extends CostItem {
  id: string;
  category: string;
  level: string;
  is_structural: boolean;
  fire_rating: string;
  ebkp: string;
  ebkph: string;
  ebkph1: string;
  ebkph2: string;
  ebkph3: string;
  cost_unit: number;
  area: number;
  cost: number;
  element_count: number;
  fileID: string;
  fromKafka: boolean;
  kafkaSource: string;
  kafkaTimestamp: string;
  areaSource: string;
  einheit: string;
  menge: number;
  totalChf: number;
  kennwert: number;
  bezeichnung: string;
  originalItem?: Partial<CostItem>;
}

interface BaseWebSocketMessage {
  type: string;
  messageId: string;
}

interface CostDataMessage extends BaseWebSocketMessage {
  type: "cost_data";
  data: CostItem[];
}

interface CostDataResponseMessage extends BaseWebSocketMessage {
  type: "cost_data_response";
  status?: string;
  message?: string;
}

// Add types for batch saving
interface CostBatchMessage extends BaseWebSocketMessage {
  type: "save_cost_batch";
  payload: {
    projectName: string;
    costItems: EnhancedCostItem[];
  };
}

interface CostBatchResponseMessage extends BaseWebSocketMessage {
  type: "save_cost_batch_response";
  status: "success" | "error";
  message?: string;
}

// Combine message types
type WebSocketMessage =
  | CostDataMessage
  | CostDataResponseMessage
  | CostBatchMessage
  | CostBatchResponseMessage;

// Define window interface to include WebSocket
interface CustomWindow extends Window {
  ws: WebSocket;
}

// Function to send cost data to server with better timeout handling
const sendCostDataToServer = async (costData: CostItem[]) => {
  const ws = (window as unknown as CustomWindow).ws; // Using proper type assertion chain
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket connection not available");
  }

  const messageId = `cost_${Date.now()}${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  // Add messageId to the data
  const message: WebSocketMessage = {
    type: "cost_data",
    messageId,
    data: costData,
  };

  // Send the message
  ws.send(JSON.stringify(message));
  console.log("Cost data sent to server");

  // Wait for response with a longer timeout (30 seconds)
  const responsePromise = new Promise((resolve, reject) => {
    const responseHandler = (event: MessageEvent) => {
      try {
        const response: WebSocketMessage = JSON.parse(event.data);

        // Check if this is the response for our message
        if (
          response.type === "cost_data_response" &&
          response.messageId === messageId
        ) {
          ws.removeEventListener("message", responseHandler);
          clearTimeout(timeoutId);

          if (response.status === "success") {
            resolve(response);
          } else {
            reject(new Error(response.message || "Error saving cost data"));
          }
        }
      } catch {
        // Ignore parse errors from other messages
      }
    };

    // Add the event listener
    ws.addEventListener("message", responseHandler);

    // Set a timeout of 30 seconds
    const timeoutId = setTimeout(() => {
      ws.removeEventListener("message", responseHandler);
      reject(new Error("Response timeout"));
    }, 30000);
  });

  // Add event listener to handle connection closure
  const closePromise = new Promise((_, reject) => {
    const closeHandler = () => {
      reject(new Error("WebSocket connection closed before response"));
    };

    ws.addEventListener("close", closeHandler);

    // Clean up when responsePromise resolves or rejects
    responsePromise
      .finally(() => {
        ws.removeEventListener("close", closeHandler);
      })
      .catch(() => {}); // Prevent unhandled promise rejection
  });

  // Return whichever promise resolves/rejects first
  return Promise.race([responsePromise, closePromise]);
};

export default sendCostDataToServer;

// Export the new function for sending batch cost data
export const sendCostBatchToServer = async (
  projectName: string,
  costItems: EnhancedCostItem[]
): Promise<CostBatchResponseMessage> => {
  const ws = (window as unknown as CustomWindow).ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket connection not available");
  }

  const messageId = `batch_${Date.now()}${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  // Create the message payload
  const message: CostBatchMessage = {
    type: "save_cost_batch",
    messageId,
    payload: {
      projectName,
      costItems,
    },
  };

  // Send the message
  ws.send(JSON.stringify(message));
  console.log(`Cost batch sent to server for project ${projectName}`);

  // Wait for response with a longer timeout (e.g., 60 seconds for potentially large batches)
  return new Promise((resolve, reject) => {
    const responseHandler = (event: MessageEvent) => {
      try {
        const response = JSON.parse(event.data) as CostBatchResponseMessage;

        // Check if this is the response for our message
        if (
          response.type === "save_cost_batch_response" &&
          response.messageId === messageId
        ) {
          ws.removeEventListener("message", responseHandler);
          clearTimeout(timeoutId);
          resolve(response); // Resolve with the full response object
        }
      } catch {
        // Ignore parse errors from other messages
      }
    };

    // Add the event listener
    ws.addEventListener("message", responseHandler);

    // Set a timeout (e.g., 60 seconds)
    const timeoutId = setTimeout(() => {
      ws.removeEventListener("message", responseHandler);
      reject(new Error("Timeout waiting for save_cost_batch_response"));
    }, 60000);

    // Handle connection closure
    const closeHandler = () => {
      ws.removeEventListener("message", responseHandler);
      reject(new Error("WebSocket connection closed before response"));
    };
    ws.addEventListener("close", closeHandler, { once: true });
  });
};

// Similar updates for requestCodeMatching function
