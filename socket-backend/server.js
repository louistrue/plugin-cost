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
    groupId: process.env.KAFKA_GROUP_ID || "plugin-cost-consumer",
  },
  websocket: {
    port: parseInt(process.env.WEBSOCKET_PORT || "8001"),
  },
};

console.log("Starting WebSocket server with configuration:", {
  kafkaBroker: config.kafka.broker,
  kafkaTopic: config.kafka.topic,
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
const admin = kafka.admin();

// Create consumer
const consumer = kafka.consumer({ groupId: config.kafka.groupId });

// Create HTTP server for both health check and WebSocket
const server = http.createServer((req, res) => {
  // Simple health check endpoint
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "UP",
        kafka: consumer.isRunning ? "CONNECTED" : "DISCONNECTED",
      })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Setup WebSocket server on the same HTTP server
const wss = new WebSocket.Server({ server });

// Track active clients
const clients = new Set();
let isKafkaConnected = false;

// Handle WebSocket connections
wss.on("connection", (ws) => {
  console.log("New client connected");
  clients.add(ws);

  // Send connection status
  ws.send(
    JSON.stringify({
      type: "connection",
      status: "connected",
      kafka: isKafkaConnected ? "CONNECTED" : "CONNECTING",
    })
  );

  // Handle client disconnection
  ws.on("close", () => {
    console.log("Client disconnected");
    clients.delete(ws);
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    clients.delete(ws);
  });
});

// Function to broadcast messages to all connected clients
function broadcast(message) {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
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

// Handle server shutdown
const shutdown = async () => {
  console.log("Shutting down...");

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    client.close();
  });

  // Disconnect Kafka consumer
  try {
    if (consumer.isRunning) {
      await consumer.disconnect();
      console.log("Kafka consumer disconnected");
    }
  } catch (error) {
    console.error("Error disconnecting Kafka consumer:", error);
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

  // Start the Kafka connection
  run().catch(console.error);

  // Start sending test messages if Kafka is not available
  setTimeout(sendTestMessage, 10000); // Start after 10 seconds
});
