/**
 * WebSocket utility for plugin-cost
 * Provides a robust WebSocket connection with automatic reconnection
 */

// Configurable options
const WS_OPTIONS = {
  reconnectInterval: 2000,
  maxReconnectAttempts: 5,
  pingInterval: 30000,
  messageTimeout: 30000,
};

// Connection status enum
export enum ConnectionStatus {
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
  ERROR = "ERROR",
}

// Shared WebSocket instance
let globalWs: WebSocket | null = null;
let reconnectAttempts = 0;
let pingInterval: number | null = null;
let connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

// Event handlers
const messageHandlers: Record<string, ((data: unknown) => void)[]> = {};
const statusChangeHandlers: ((status: ConnectionStatus) => void)[] = [];

/**
 * Initialize WebSocket connection
 * @param url WebSocket URL
 */
export function initWebSocket(url: string): Promise<void> {
  // Clear any existing connections
  if (globalWs) {
    cleanupWebSocket();
  }

  connectionStatus = ConnectionStatus.CONNECTING;
  notifyStatusChange();

  return new Promise((resolve, reject) => {
    try {
      console.log("Initializing WebSocket connection to:", url);

      globalWs = new WebSocket(url);

      globalWs.onopen = () => {
        console.log("WebSocket connection established");
        connectionStatus = ConnectionStatus.CONNECTED;
        notifyStatusChange();

        // Reset reconnect attempts
        reconnectAttempts = 0;

        // Start ping interval
        startPingInterval();

        resolve();
      };

      globalWs.onclose = (event) => {
        console.log(
          `WebSocket connection closed: ${event.code} ${event.reason}`
        );
        connectionStatus = ConnectionStatus.DISCONNECTED;
        notifyStatusChange();

        // Clear ping interval
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }

        // Attempt to reconnect if not closing intentionally
        if (event.code !== 1000 && event.code !== 1001) {
          attemptReconnect(url);
        }
      };

      globalWs.onerror = (error) => {
        console.error("WebSocket error:", error);
        connectionStatus = ConnectionStatus.ERROR;
        notifyStatusChange();

        reject(error);
      };

      globalWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle pong response
          if (data.type === "pong") {
            return;
          }

          // Dispatch to registered handlers
          const handlers = messageHandlers[data.type] || [];
          handlers.forEach((handler) => {
            try {
              handler(data);
            } catch (error) {
              console.error(
                `Error in message handler for ${data.type}:`,
                error
              );
            }
          });

          // Check for response correlations
          if (data.messageId && pendingRequests[data.messageId]) {
            const { resolve, reject, timeoutId } =
              pendingRequests[data.messageId];

            // Clear timeout
            if (timeoutId) {
              clearTimeout(timeoutId);
            }

            // Resolve or reject based on status
            if (data.status === "success" || data.status === "ok") {
              resolve(data);
            } else {
              reject(new Error(data.message || "Unknown error"));
            }

            // Remove from pending requests
            delete pendingRequests[data.messageId];
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };
    } catch (error) {
      console.error("Error initializing WebSocket:", error);
      connectionStatus = ConnectionStatus.ERROR;
      notifyStatusChange();
      reject(error);
    }
  });
}

/**
 * Attempt to reconnect to WebSocket
 */
function attemptReconnect(url: string) {
  if (reconnectAttempts >= WS_OPTIONS.maxReconnectAttempts) {
    console.error(
      `Max reconnect attempts (${WS_OPTIONS.maxReconnectAttempts}) reached. Giving up.`
    );
    return;
  }

  reconnectAttempts++;

  console.log(
    `Attempting to reconnect (${reconnectAttempts}/${WS_OPTIONS.maxReconnectAttempts})...`
  );

  setTimeout(() => {
    initWebSocket(url).catch((error) => {
      console.error("Reconnection attempt failed:", error);
    });
  }, WS_OPTIONS.reconnectInterval);
}

/**
 * Clean up WebSocket connection
 */
function cleanupWebSocket() {
  if (globalWs) {
    if (
      globalWs.readyState === WebSocket.OPEN ||
      globalWs.readyState === WebSocket.CONNECTING
    ) {
      globalWs.close(1000, "Intentional disconnect");
    }
    globalWs = null;
  }

  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }

  // Clear all pending requests
  Object.values(pendingRequests).forEach((request) => {
    if (request.timeoutId) {
      clearTimeout(request.timeoutId);
    }
    request.reject(new Error("WebSocket connection closed"));
  });
  pendingRequests = {};
}

/**
 * Start ping interval to keep connection alive
 */
function startPingInterval() {
  if (pingInterval) {
    clearInterval(pingInterval);
  }

  pingInterval = window.setInterval(() => {
    if (globalWs && globalWs.readyState === WebSocket.OPEN) {
      globalWs.send(JSON.stringify({ type: "ping" }));
    }
  }, WS_OPTIONS.pingInterval);
}

/**
 * Register a message handler
 * @param type Message type
 * @param handler Handler function
 */
export function onMessage(type: string, handler: (data: unknown) => void) {
  if (!messageHandlers[type]) {
    messageHandlers[type] = [];
  }

  messageHandlers[type].push(handler);

  // Return unsubscribe function
  return () => {
    const index = messageHandlers[type].indexOf(handler);
    if (index !== -1) {
      messageHandlers[type].splice(index, 1);
    }
  };
}

/**
 * Register a status change handler
 * @param handler Status change handler
 */
export function onStatusChange(handler: (status: ConnectionStatus) => void) {
  statusChangeHandlers.push(handler);

  // Immediately call with current status
  handler(connectionStatus);

  // Return unsubscribe function
  return () => {
    const index = statusChangeHandlers.indexOf(handler);
    if (index !== -1) {
      statusChangeHandlers.splice(index, 1);
    }
  };
}

/**
 * Notify all status change handlers
 */
function notifyStatusChange() {
  statusChangeHandlers.forEach((handler) => {
    try {
      handler(connectionStatus);
    } catch (error) {
      console.error("Error in status change handler:", error);
    }
  });
}

// Pending request tracking
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutId: number | null;
}

let pendingRequests: Record<string, PendingRequest> = {};

/**
 * Send a request to the WebSocket server and wait for a response
 * @param type Request type
 * @param data Request data
 * @param timeout Request timeout in ms
 */
export function sendRequest(
  type: string,
  data: unknown = {},
  timeout: number = WS_OPTIONS.messageTimeout
): Promise<unknown> {
  if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("WebSocket not connected"));
  }

  // Store a reference to globalWs to ensure it's not null within the Promise scope
  const ws = globalWs;

  return new Promise((resolve, reject) => {
    // Generate a unique message ID
    const messageId = `${type}_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 10)}`;

    // Create the message
    const baseMessage = {
      type,
      messageId,
    };

    // Conditionally add data properties if data is an object
    const messageToSend =
      typeof data === "object" && data !== null
        ? { ...baseMessage, ...data }
        : baseMessage;

    // Set up timeout
    const timeoutId = window.setTimeout(() => {
      if (pendingRequests[messageId]) {
        delete pendingRequests[messageId];
        reject(new Error(`Request timed out after ${timeout}ms`));
      }
    }, timeout);

    // Store the pending request
    pendingRequests[messageId] = {
      resolve,
      reject,
      timeoutId,
    };

    // Send the message
    if (ws) {
      try {
        ws.send(JSON.stringify(messageToSend));
      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        delete pendingRequests[messageId];
        reject(error);
      }
    }
  });
}

/**
 * Send cost data to the server
 * @param costData Cost data to send
 */
export function sendCostData(costData: unknown): Promise<unknown> {
  console.log("Sending cost data:", costData);

  return sendRequest("cost_data", { data: costData }, 60000); // Longer timeout for cost data
}

/**
 * Request code matching information
 */
export function requestCodeMatching(): Promise<unknown> {
  return sendRequest("request_code_matching", {}, 30000);
}

/**
 * Check if WebSocket is connected
 */
export function isConnected(): boolean {
  return globalWs !== null && globalWs.readyState === WebSocket.OPEN;
}

/**
 * Get the current connection status
 */
export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus;
}

/**
 * Close the WebSocket connection
 */
export function closeConnection(
  code: number = 1000,
  reason: string = "User initiated close"
): void {
  if (
    globalWs &&
    (globalWs.readyState === WebSocket.OPEN ||
      globalWs.readyState === WebSocket.CONNECTING)
  ) {
    globalWs.close(code, reason);
  }

  cleanupWebSocket();
}
