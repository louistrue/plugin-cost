const { Kafka } = require("kafkajs");
const WebSocket = require("ws");
const http = require("http");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Configuration
const config = {
  kafka: {
    broker: process.env.KAFKA_BROKER || "broker:29092",
    topic: process.env.KAFKA_TOPIC || "qto-elements",
    costTopic: process.env.KAFKA_COST_TOPIC || "cost-data",
    groupId: process.env.KAFKA_GROUP_ID || "plugin-cost-consumer",
  },
  websocket: {
    port: parseInt(process.env.WEBSOCKET_PORT || "8001"),
  },
};

console.log("Starting WebSocket server with configuration:", {
  kafkaBroker: config.kafka.broker,
  kafkaTopic: config.kafka.topic,
  kafkaCostTopic: config.kafka.costTopic,
  websocketPort: config.websocket.port,
});

// Setup Kafka client
const kafka = new Kafka({
  clientId: "plugin-cost-websocket",
  brokers: [config.kafka.broker],
  retry: {
    initialRetryTime: 1000,
    retries: 10,
  },
});

// Create producer for admin operations
const producer = kafka.producer();
const costProducer = kafka.producer();
const admin = kafka.admin();

// Create consumer
const consumer = kafka.consumer({ groupId: config.kafka.groupId });

// Create HTTP server for both health check and WebSocket
const server = http.createServer((req, res) => {
  // Add CORS headers to all responses
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle OPTIONS pre-flight requests
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Simple health check endpoint
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "UP",
        kafka: consumer.isRunning ? "CONNECTED" : "DISCONNECTED",
        costProducer: costProducer.isConnected ? "CONNECTED" : "DISCONNECTED",
        clients: clients.size,
        topics: [config.kafka.topic, config.kafka.costTopic],
      })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Setup WebSocket server on the same HTTP server
const wss = new WebSocket.Server({
  server,
  // Add WebSocket configs for better performance
  perMessageDeflate: false, // Disable per-message deflate to reduce CPU usage
  // Set keep-alive ping interval
  clientTracking: true,
  // Set timeout to automatically close inactive connections
  handleProtocols: () => "echo-protocol",
});

// Track active clients with IDs for better debugging
let nextClientId = 1;
const clients = new Map(); // Changed from Set to Map to store client IDs
let isKafkaConnected = false;

// Function to set up heartbeat mechanism for a client
function setupHeartbeat(ws, clientId) {
  // Mark the connection as alive
  ws.isAlive = true;

  // Set up ping handler
  ws.on("pong", () => {
    console.log(`Received pong from client ${clientId}`);
    ws.isAlive = true;
  });
}

// Interval to ping clients and terminate dead connections
const heartbeatInterval = setInterval(() => {
  console.log(`Running heartbeat check for ${clients.size} clients`);

  clients.forEach((ws, clientId) => {
    if (ws.isAlive === false) {
      console.log(
        `Client ${clientId} didn't respond to ping, terminating connection`
      );
      ws.terminate();
      clients.delete(clientId);
      return;
    }

    ws.isAlive = false;
    try {
      ws.ping("", false, true);
    } catch (error) {
      console.error(`Error pinging client ${clientId}:`, error.message);
      ws.terminate();
      clients.delete(clientId);
    }
  });
}, 30000); // Check every 30 seconds

// Clean up the interval on server close
process.on("SIGINT", () => {
  clearInterval(heartbeatInterval);
  process.exit(0);
});

// Handle WebSocket connections
wss.on("connection", (ws, req) => {
  const clientId = nextClientId++;
  const ip = req.socket.remoteAddress;
  console.log(`New client connected: ID=${clientId}, IP=${ip}`);

  // Store client with ID
  clients.set(clientId, ws);

  // Attach client ID for tracking
  ws.clientId = clientId;

  // Setup heartbeat mechanism
  setupHeartbeat(ws, clientId);

  // Send connection status
  ws.send(
    JSON.stringify({
      type: "connection",
      status: "connected",
      clientId: clientId,
      kafka: isKafkaConnected ? "CONNECTED" : "CONNECTING",
    })
  );

  // Handle client messages
  ws.on("message", async (data) => {
    try {
      console.log(
        `Received message from client ${clientId}: ${data
          .toString()
          .substring(0, 200)}...`
      );
      const message = JSON.parse(data);

      // Handle ping messages to keep connection alive
      if (message.type === "ping") {
        console.log(`Received ping from client ${clientId}, sending pong`);
        try {
          ws.send(JSON.stringify({ type: "pong" }));
        } catch (sendError) {
          console.error(
            `Error sending pong to client ${clientId}:`,
            sendError.message
          );
        }
        return;
      }

      // If this is a cost data message
      if (message.type === "cost_data") {
        console.log(`Client ${clientId} sent cost data`);

        try {
          // Validate the cost data
          if (!message.data || !Array.isArray(message.data.data)) {
            throw new Error("Invalid cost data format - missing data array");
          }

          console.log(`Cost data contains ${message.data.data.length} items`);
          await sendCostDataToKafka(message.data);
          console.log("Cost data successfully sent to Kafka");

          // Send acknowledgment back to client
          ws.send(
            JSON.stringify({
              type: "cost_data_response",
              status: "success",
              message: "Cost data sent to Kafka successfully",
            })
          );
        } catch (costError) {
          console.error(
            `Error sending cost data for client ${clientId}:`,
            costError
          );

          // Send error response
          ws.send(
            JSON.stringify({
              type: "cost_data_response",
              status: "error",
              message: `Error sending cost data: ${costError.message}`,
            })
          );
        }
      } else {
        console.log(
          `Client ${clientId} sent unknown message type: ${message.type}`
        );
      }
    } catch (error) {
      console.error(`Error processing client ${clientId} message:`, error);

      // Send error response
      try {
        ws.send(
          JSON.stringify({
            type: "cost_data_response",
            status: "error",
            message: `Error processing message: ${error.message}`,
          })
        );
      } catch (sendError) {
        console.error(
          `Error sending error response to client ${clientId}:`,
          sendError
        );
      }
    }
  });

  // Handle client disconnection
  ws.on("close", (code, reason) => {
    console.log(
      `Client ${clientId} disconnected: code=${code}, reason=${
        reason || "No reason provided"
      }`
    );

    // Remove the client from our map
    clients.delete(clientId);

    // Log the number of remaining clients
    console.log(`Remaining clients: ${clients.size}`);
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error.message);

    // Try to close the connection gracefully
    try {
      ws.close();
    } catch (closeError) {
      console.error(
        `Error closing connection for client ${clientId}:`,
        closeError.message
      );
      // Terminate the connection forcefully if close fails
      ws.terminate();
    }

    // Remove the client from our map
    clients.delete(clientId);
  });
});

// Function to broadcast messages to all connected clients
function broadcast(message) {
  let sentCount = 0;
  let errorCount = 0;
  let closedCount = 0;

  clients.forEach((client, clientId) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        sentCount++;
      } catch (error) {
        console.error(
          `Error broadcasting to client ${clientId}:`,
          error.message
        );
        errorCount++;
      }
    } else if (
      client.readyState === WebSocket.CLOSED ||
      client.readyState === WebSocket.CLOSING
    ) {
      // Clean up clients that are already closed
      console.log(
        `Client ${clientId} connection is already closed, removing from client list`
      );
      clients.delete(clientId);
      closedCount++;
    }
  });

  if (clients.size > 0 || closedCount > 0) {
    console.log(
      `Broadcast complete: ${sentCount} clients received, ${errorCount} errors, ${closedCount} closed connections removed`
    );
  }
}

// Check if Kafka topic exists or create it
async function ensureTopicExists(topic) {
  try {
    // Connect to the admin client
    await admin.connect();

    // List existing topics
    const topics = await admin.listTopics();
    console.log(`Available Kafka topics: ${topics.join(", ")}`);

    // If topic doesn't exist, create it
    if (!topics.includes(topic)) {
      console.log(`Topic '${topic}' does not exist. Creating it...`);
      await admin.createTopics({
        topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
      });
      console.log(`Created topic: ${topic}`);
    } else {
      console.log(`Topic '${topic}' already exists`);
    }

    return true;
  } catch (error) {
    console.error(`Error checking/creating Kafka topic: ${error.message}`);
    return false;
  } finally {
    await admin.disconnect();
  }
}

// Start Kafka consumer and connect to WebSocket
async function run() {
  try {
    // First check Kafka connection by connecting a producer
    await producer.connect();
    console.log("Connected to Kafka broker (producer):", config.kafka.broker);

    // Check if topic exists and create it if it doesn't
    const topicExists = await ensureTopicExists(config.kafka.topic);
    if (!topicExists) {
      throw new Error(`Failed to ensure topic ${config.kafka.topic} exists`);
    }

    // Disconnect producer as we don't need it anymore
    await producer.disconnect();

    // Now connect the consumer
    await consumer.connect();
    console.log("Connected to Kafka broker (consumer):", config.kafka.broker);
    isKafkaConnected = true;

    // Broadcast Kafka connection status to all clients
    broadcast(JSON.stringify({ type: "kafka_status", status: "CONNECTED" }));

    // Subscribe to topic
    await consumer.subscribe({
      topic: config.kafka.topic,
      fromBeginning: false,
    });
    console.log("Subscribed to topic:", config.kafka.topic);

    // Start consuming messages
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const messageValue = message.value?.toString();
          if (messageValue) {
            console.log(
              `Received message from Kafka topic ${topic}:`,
              messageValue.substring(0, 200) + "..."
            );

            // Forward message to all connected WebSocket clients
            broadcast(messageValue);
          }
        } catch (err) {
          console.error("Error processing message:", err);
        }
      },
    });
  } catch (error) {
    console.error("Error running Kafka consumer:", error);
    isKafkaConnected = false;

    // Broadcast Kafka connection status to all clients
    broadcast(
      JSON.stringify({
        type: "kafka_status",
        status: "DISCONNECTED",
        error: error.message,
      })
    );

    // Try to reconnect after a delay
    setTimeout(() => {
      console.log("Attempting to reconnect to Kafka...");
      run();
    }, 5000);
  }
}

// Generate a sample message for testing
function generateTestMessage() {
  const timestamp = new Date().toISOString();
  return {
    project: "Test Project",
    filename: "test.ifc",
    timestamp: timestamp,
    file_id: `test.ifc_${timestamp}`,
    elements: [
      {
        id: "test_element_1",
        category: "ifcwall",
        level: "Level_1",
        area: 45.5,
        is_structural: true,
        is_external: false,
        ebkph: "C2.1",
        materials: [
          {
            name: "Concrete",
            fraction: 0.8,
            volume: 20,
          },
        ],
        classification: {
          id: "C2.1",
          name: "Innenwand",
          system: "EBKP",
        },
      },
    ],
  };
}

// Send a test message if WebSocket is connected but Kafka is not
function sendTestMessage() {
  if (clients.size > 0 && !isKafkaConnected) {
    console.log("Sending test message to clients...");
    broadcast(JSON.stringify(generateTestMessage()));
  }

  // Schedule next test message
  setTimeout(sendTestMessage, 15000); // Every 15 seconds
}

// Format cost data according to the required structure
function formatCostData(costData) {
  // Extract base data
  const { project, filename, timestamp, data } = costData;

  if (!project || !filename || !data || !Array.isArray(data)) {
    throw new Error("Invalid cost data format - missing required fields");
  }

  console.log(`Formatting cost data with ${data.length} items`);

  // Format according to CostMessage structure
  const costMessage = {
    project,
    filename,
    timestamp: timestamp || new Date().toISOString(),
    data: data.map((item) => {
      // Parse EBKPH components if available
      let ebkph1 = "",
        ebkph2 = "",
        ebkph3 = "";
      if (item.ebkph) {
        const parts = item.ebkph.split(".");
        ebkph1 = parts[0] || "";
        ebkph2 = parts.length > 1 ? parts[1] : "";
        ebkph3 = parts.length > 2 ? parts[2] : "";
      }

      // Return formatted item
      return {
        id: item.id || `unknown-${Math.random().toString(36).substring(2, 10)}`,
        category: item.category || "",
        level: item.level || "",
        is_structural:
          item.is_structural === undefined ? true : item.is_structural,
        fire_rating: item.fire_rating || "",
        ebkph: item.ebkph || "",
        ebkph1,
        ebkph2,
        ebkph3,
        cost: parseFloat(item.cost || 0),
        cost_unit: parseFloat(item.cost_unit || 0),
      };
    }),
    fileID: `${project}/${filename}`,
  };

  return costMessage;
}

// Send cost data to Kafka
async function sendCostDataToKafka(costData) {
  try {
    // Make sure cost topic exists
    console.log(`Ensuring cost topic exists: ${config.kafka.costTopic}`);
    await ensureTopicExists(config.kafka.costTopic);

    // Make sure cost producer is connected
    if (!costProducer.isConnected) {
      console.log("Connecting cost producer to Kafka...");
      await costProducer.connect();
      console.log("Cost producer connected to Kafka");
    }

    // Format the data
    console.log("Formatting cost data for Kafka...");
    const formattedData = formatCostData(costData);
    console.log("Cost data formatted successfully");

    // Send to Kafka
    console.log(
      `Sending cost data to Kafka topic ${config.kafka.costTopic}...`
    );
    const result = await costProducer.send({
      topic: config.kafka.costTopic,
      messages: [
        {
          value: JSON.stringify(formattedData),
          key: formattedData.fileID,
        },
      ],
    });

    console.log(
      `Cost data sent to Kafka topic ${config.kafka.costTopic}:`,
      result
    );
    return true;
  } catch (error) {
    console.error("Error sending cost data to Kafka:", error);
    throw error;
  }
}

// Handle server shutdown
const shutdown = async () => {
  console.log("Shutting down...");

  // Clear intervals
  clearInterval(heartbeatInterval);

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    client.close();
  });

  // Disconnect Kafka consumer and producers
  try {
    if (consumer.isRunning) {
      await consumer.disconnect();
      console.log("Kafka consumer disconnected");
    }

    if (producer.isConnected) {
      await producer.disconnect();
      console.log("Kafka producer disconnected");
    }

    if (costProducer.isConnected) {
      await costProducer.disconnect();
      console.log("Cost producer disconnected");
    }
  } catch (error) {
    console.error("Error disconnecting Kafka clients:", error);
  }

  // Close HTTP server
  server.close();

  process.exit(0);
};

// Handle process termination
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start the server
server.listen(config.websocket.port, () => {
  console.log(`WebSocket server started on port ${config.websocket.port}`);

  // Start the Kafka connection and ensure topics exist
  run().catch(console.error);

  // Ensure the cost topic exists and connect cost producer
  ensureTopicExists(config.kafka.costTopic)
    .then(() => {
      return costProducer.connect();
    })
    .then(() => console.log("Cost producer connected to Kafka"))
    .catch((err) => console.error("Error connecting cost producer:", err));

  // Start sending test messages if Kafka is not available
  setTimeout(sendTestMessage, 10000); // Start after 10 seconds
});
