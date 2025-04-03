import { CostItem } from "./CostUploader/types";

interface WebSocketMessage {
  type: string;
  messageId: string;
  data: CostItem[];
  status?: string;
  message?: string;
}

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

// Similar updates for requestCodeMatching function
