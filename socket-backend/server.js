const { Kafka } = require("kafkajs");
const WebSocket = require("ws");
const http = require("http");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

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
  storage: {
    elementFile: process.env.ELEMENT_FILE || "ifc_elements.json",
    saveInterval: parseInt(process.env.SAVE_INTERVAL || "300000"), // 5 minutes
  },
};

// Store unit costs by EBKPH code in memory
const unitCostsByEbkph = {};

// Store IFC elements by EBKPH code
const ifcElementsByEbkph = {};

// Track elements to prevent duplicates
const processedElementIds = new Set();

// Storage for elements by project
const elementsByProject = {};

console.log("Starting WebSocket server with configuration:", {
  kafkaBroker: config.kafka.broker,
  kafkaTopic: config.kafka.topic,
  kafkaCostTopic: config.kafka.costTopic,
  websocketPort: config.websocket.port,
  elementFile: config.storage.elementFile,
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
        elements: {
          stored: processedElementIds.size,
          byEbkph: Object.keys(ifcElementsByEbkph).length,
          byProject: Object.keys(elementsByProject).length,
        },
      })
    );
  }
  // Endpoint to get all stored elements
  else if (req.url === "/elements") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        elementCount: processedElementIds.size,
        ebkphCodes: Object.keys(ifcElementsByEbkph),
        projects: Object.keys(elementsByProject),
        timestamp: new Date().toISOString(),
      })
    );
  }
  // Get elements by EBKPH code
  else if (req.url.startsWith("/elements/ebkph/")) {
    const ebkpCode = req.url.replace("/elements/ebkph/", "");
    const normalizedCode = normalizeEbkpCode(ebkpCode);
    const elements = ifcElementsByEbkph[normalizedCode] || [];

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ebkphCode: ebkpCode,
        normalizedCode,
        elements,
        count: elements.length,
        hasCost: unitCostsByEbkph[normalizedCode] !== undefined,
      })
    );
  }
  // Get elements by project
  else if (req.url.startsWith("/elements/project/")) {
    const projectName = decodeURIComponent(
      req.url.replace("/elements/project/", "")
    );
    const projectData = elementsByProject[projectName] || {};

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        project: projectName,
        ebkphCodes: Object.keys(projectData),
        elementCount: Object.values(projectData).reduce(
          (count, elements) => count + elements.length,
          0
        ),
      })
    );
  }
  // Add new endpoint for debugging EBKPH code matching
  else if (req.url === "/debug/codes") {
    // Collect Excel cost codes
    const excelCodes = Object.keys(unitCostsByEbkph).map((code) => ({
      code,
      normalized: code,
      originalCode: unitCostsByEbkph[code].originalCode || code,
      unitCost: unitCostsByEbkph[code].cost_unit,
    }));

    // Collect IFC element codes
    const ifcCodes = Object.keys(ifcElementsByEbkph).map((code) => ({
      code,
      normalized: code,
      elementCount: ifcElementsByEbkph[code].length,
    }));

    // Find potential matches (codes that should match but don't)
    const potentialMatches = [];
    const automaticMatches = [];

    ifcCodes.forEach((ifcCode) => {
      const match = findBestEbkphMatch(ifcCode.code);
      if (match && match.method !== "direct") {
        automaticMatches.push({
          ifcCode: ifcCode.code,
          matchedWith: match.code,
          method: match.method,
          unitCost: match.costInfo.cost_unit,
          elementCount: ifcCode.elementCount,
        });
      }
    });

    excelCodes.forEach((excelCode) => {
      // Check for close matches that don't match exactly
      ifcCodes.forEach((ifcCode) => {
        // Simple comparison: codes that match when lowercased and spaces/zeros removed
        const simplifiedExcel = excelCode.originalCode
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace(/^([a-z])0+(\d+)/g, "$1$2");
        const simplifiedIfc = ifcCode.code
          .toLowerCase()
          .replace(/\s+/g, "")
          .replace(/^([a-z])0+(\d+)/g, "$1$2");

        if (
          simplifiedExcel === simplifiedIfc &&
          excelCode.code !== ifcCode.code
        ) {
          potentialMatches.push({
            excelCode: excelCode.originalCode,
            normalizedExcel: excelCode.code,
            ifcCode: ifcCode.code,
            normalizedIfc: ifcCode.normalized,
            simplifiedExcel,
            simplifiedIfc,
            reason: "Similar but not matching exactly",
          });
        }
      });
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          excelCodes,
          ifcCodes,
          potentialMatches,
          automaticMatches,
          matchingCodes: excelCodes
            .filter((ec) => ifcCodes.some((ic) => ic.code === ec.code))
            .map((ec) => ec.code),
          timestamp: new Date().toISOString(),
        },
        null,
        2
      ) // Pretty print JSON
    );
  }
  // Get unit costs
  else if (req.url === "/costs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        costCount: Object.keys(unitCostsByEbkph).length,
        ebkphCodes: Object.keys(unitCostsByEbkph),
      })
    );
  }
  // Add handler for reapplying costs to all elements
  else if (req.url === "/reapply_costs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "success",
        message: "This endpoint is not implemented in the current version.",
      })
    );
  }
  // Not found
  else {
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

  // Send element information for the client's reference
  const elementInfo = {
    type: "element_info",
    elementCount: processedElementIds.size,
    ebkphCodes: Object.keys(ifcElementsByEbkph),
    projects: Object.keys(elementsByProject),
    costCodes: Object.keys(unitCostsByEbkph),
    timestamp: new Date().toISOString(),
  };

  try {
    ws.send(JSON.stringify(elementInfo));
    console.log(
      `Sent element info to client ${clientId}: ${processedElementIds.size} elements available`
    );
  } catch (error) {
    console.error(`Error sending element info to client ${clientId}:`, error);
  }

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

      // If this is a cost data message from Excel upload
      if (message.type === "cost_data") {
        console.log(`Client ${clientId} sent cost data from Excel`);

        try {
          // Validate the cost data
          if (!message.data || !Array.isArray(message.data.data)) {
            throw new Error("Invalid cost data format - missing data array");
          }

          // Extract unit costs from Excel data and store in memory
          console.log(
            `Processing ${message.data.data.length} unit costs from Excel`
          );

          // Clear existing unit costs if this is a new upload
          if (message.data.replaceExisting) {
            console.log("Clearing existing unit costs before storing new ones");
            Object.keys(unitCostsByEbkph).forEach(
              (key) => delete unitCostsByEbkph[key]
            );
          }

          // Store unit costs by EBKPH code
          message.data.data.forEach((item) => {
            if (item.ebkph && item.cost_unit) {
              // Extract EBKPH components
              let ebkph1 = "",
                ebkph2 = "",
                ebkph3 = "";
              if (item.ebkph) {
                const parts = item.ebkph.split(".");
                ebkph1 = parts[0] || "";
                ebkph2 = parts.length > 1 ? parts[1] : "";
                ebkph3 = parts.length > 2 ? parts[2] : "";
              }

              // Normalize the code for consistent lookup
              const normalizedCode = normalizeEbkpCode(item.ebkph);

              // Store ONLY what we need - focus on the unit cost (kennwert)
              unitCostsByEbkph[normalizedCode] = {
                cost_unit: parseFloat(item.cost_unit || item.kennwert || 0),
                category: item.category || item.bezeichnung || "",
                timestamp: message.data.timestamp || new Date().toISOString(),
                project: message.data.project || "excel-import",
                filename: message.data.filename || "cost-data.xlsx",
                ebkph1,
                ebkph2,
                ebkph3,
                originalCode: item.ebkph,
              };

              console.log(
                `Stored unit cost for EBKPH ${item.ebkph} (normalized: ${normalizedCode}): ${unitCostsByEbkph[normalizedCode].cost_unit}`
              );
            }
          });

          console.log(
            `Stored ${
              Object.keys(unitCostsByEbkph).length
            } unit costs in memory`
          );

          // Now, apply these costs to any stored IFC elements and send them to Kafka
          const enhancedElements = [];
          let processedCount = 0;
          let matchedCodes = {};

          // Process all stored elements by EBKPH code
          Object.keys(ifcElementsByEbkph).forEach((ebkpCode) => {
            // If we have a unit cost for this code
            if (unitCostsByEbkph[ebkpCode]) {
              const elements = ifcElementsByEbkph[ebkpCode];
              const costInfo = unitCostsByEbkph[ebkpCode];

              console.log(
                `Found match between IFC elements (${elements.length}) and Excel cost data for code ${ebkpCode}`
              );
              matchedCodes[ebkpCode] = {
                elementCount: elements.length,
                costUnit: costInfo.cost_unit,
              };

              // Enhance each element
              elements.forEach((element) => {
                const area = parseFloat(element.area || 0);
                const costUnit = costInfo.cost_unit || 0;

                // Create enhanced element
                const enhancedElement = {
                  ...element,
                  cost_unit: costUnit,
                  cost: costUnit * (area || 1),
                  cost_source: costInfo.filename,
                  cost_timestamp: costInfo.timestamp,
                };

                // Make sure EBKPH components are present
                if (costInfo.ebkph1 && !enhancedElement.ebkph1) {
                  enhancedElement.ebkph1 = costInfo.ebkph1;
                }
                if (costInfo.ebkph2 && !enhancedElement.ebkph2) {
                  enhancedElement.ebkph2 = costInfo.ebkph2;
                }
                if (costInfo.ebkph3 && !enhancedElement.ebkph3) {
                  enhancedElement.ebkph3 = costInfo.ebkph3;
                }

                // Add to list for batch processing
                enhancedElements.push(enhancedElement);
                processedCount++;
              });
            } else {
              console.log(
                `No cost data found for EBKPH code ${ebkpCode} (normalized)`
              );
            }
          });

          // Notify clients about the matches found
          if (Object.keys(matchedCodes).length > 0) {
            const matchInfo = {
              type: "cost_match_info",
              matches: matchedCodes,
              matchCount: Object.keys(matchedCodes).length,
              elementCount: processedCount,
              timestamp: new Date().toISOString(),
            };

            broadcast(JSON.stringify(matchInfo));
            console.log(
              `Broadcast cost match info: ${processedCount} elements matched across ${
                Object.keys(matchedCodes).length
              } EBKPH codes`
            );
          }

          // Send all enhanced elements to Kafka
          if (enhancedElements.length > 0) {
            console.log(
              `Sending ${enhancedElements.length} enhanced IFC elements to Kafka`
            );

            // Batch process in chunks of 50 to avoid overwhelming Kafka
            const batchSize = 50;
            for (let i = 0; i < enhancedElements.length; i += batchSize) {
              const batch = enhancedElements.slice(i, i + batchSize);

              // Create promises for sending each element
              const sendPromises = batch.map((element) =>
                sendEnhancedElementToKafka(element)
              );

              // Wait for all sends to complete
              await Promise.all(sendPromises);

              console.log(
                `Processed batch ${i / batchSize + 1}/${Math.ceil(
                  enhancedElements.length / batchSize
                )}`
              );
            }
          }

          // Send acknowledgment back to client
          ws.send(
            JSON.stringify({
              type: "cost_data_response",
              status: "success",
              message: `Unit costs stored successfully. Applied to ${processedCount} IFC elements.`,
              unitCostCount: Object.keys(unitCostsByEbkph).length,
              elementsProcessed: processedCount,
            })
          );
        } catch (costError) {
          console.error(
            `Error processing unit costs for client ${clientId}:`,
            costError
          );

          // Send error response
          ws.send(
            JSON.stringify({
              type: "cost_data_response",
              status: "error",
              message: `Error processing unit costs: ${costError.message}`,
            })
          );
        }
      } else if (message.type === "request_code_matching") {
        try {
          console.log(`Client ${clientId} requested code matching info`);

          // Collect Excel cost codes
          const excelCodes = Object.keys(unitCostsByEbkph).map((code) => ({
            code,
            originalCode: unitCostsByEbkph[code].originalCode || code,
            unitCost: unitCostsByEbkph[code].cost_unit,
          }));

          // Collect IFC element codes
          const ifcCodes = Object.keys(ifcElementsByEbkph).map((code) => ({
            code,
            elementCount: ifcElementsByEbkph[code].length,
          }));

          // Find matching codes
          const matchingCodes = excelCodes
            .filter((ec) => ifcCodes.some((ic) => ic.code === ec.code))
            .map((ec) => ({
              code: ec.code,
              unitCost: ec.unitCost,
              elementCount: ifcCodes.find((ic) => ic.code === ec.code)
                .elementCount,
            }));

          // Send back the matching information
          ws.send(
            JSON.stringify({
              type: "code_matching_info",
              excelCodeCount: excelCodes.length,
              ifcCodeCount: ifcCodes.length,
              matchingCodes,
              matchCount: matchingCodes.length,
              timestamp: new Date().toISOString(),
            })
          );
        } catch (error) {
          console.error(`Error processing code matching request: ${error}`);
          ws.send(
            JSON.stringify({
              type: "error",
              status: "error",
              message: `Error processing code matching request: ${error.message}`,
            })
          );
        }
      } else if (message.type === "reapply_costs") {
        try {
          console.log(
            `Client ${clientId} requested to reapply cost data to all elements`
          );

          if (Object.keys(unitCostsByEbkph).length === 0) {
            ws.send(
              JSON.stringify({
                type: "reapply_costs_response",
                status: "warning",
                message:
                  "No unit costs available to apply. Please upload an Excel file with cost data first.",
              })
            );
            return;
          }

          // Process all stored elements
          const enhancedElements = [];
          let processedCount = 0;
          let matchedCodes = {};

          Object.keys(ifcElementsByEbkph).forEach((ebkpCode) => {
            const elements = ifcElementsByEbkph[ebkpCode];

            // Find the best match for this EBKPH code
            const bestMatch = findBestEbkphMatch(ebkpCode);

            if (bestMatch) {
              const costInfo = bestMatch.costInfo;
              const costUnit = costInfo.cost_unit || 0;

              console.log(
                `Found ${bestMatch.method} match for EBKPH ${ebkpCode}: ${bestMatch.code}, unit cost = ${costUnit}`
              );

              if (!matchedCodes[bestMatch.code]) {
                matchedCodes[bestMatch.code] = {
                  elementCount: 0,
                  costUnit: costUnit,
                };
              }

              // Process all elements with this code
              elements.forEach((element) => {
                const area = parseFloat(element.area || 0);

                // Create enhanced element
                const enhancedElement = {
                  ...element,
                  cost_unit: costUnit,
                  cost: costUnit * (area || 1),
                  cost_source: costInfo.filename,
                  cost_timestamp: costInfo.timestamp,
                  cost_match_method: bestMatch.method,
                };

                // Ensure EBKPH components are present
                if (costInfo.ebkph1 && !enhancedElement.ebkph1) {
                  enhancedElement.ebkph1 = costInfo.ebkph1;
                }
                if (costInfo.ebkph2 && !enhancedElement.ebkph2) {
                  enhancedElement.ebkph2 = costInfo.ebkph2;
                }
                if (costInfo.ebkph3 && !enhancedElement.ebkph3) {
                  enhancedElement.ebkph3 = costInfo.ebkph3;
                }

                // Add to list for batch processing
                enhancedElements.push(enhancedElement);
                processedCount++;
                matchedCodes[bestMatch.code].elementCount++;
              });
            }
          });

          // Send all enhanced elements to Kafka
          if (enhancedElements.length > 0) {
            console.log(
              `Sending ${enhancedElements.length} enhanced IFC elements to Kafka`
            );

            // Batch process in chunks of 50 to avoid overwhelming Kafka
            const batchSize = 50;
            for (let i = 0; i < enhancedElements.length; i += batchSize) {
              const batch = enhancedElements.slice(i, i + batchSize);

              // Create promises for sending each element
              const sendPromises = batch.map((element) =>
                sendEnhancedElementToKafka(element)
              );

              // Wait for all sends to complete
              await Promise.all(sendPromises);

              console.log(
                `Processed batch ${i / batchSize + 1}/${Math.ceil(
                  enhancedElements.length / batchSize
                )}`
              );
            }
          }

          // Notify all clients about the matches
          if (Object.keys(matchedCodes).length > 0) {
            const matchInfo = {
              type: "cost_match_info",
              matches: matchedCodes,
              matchCount: Object.keys(matchedCodes).length,
              elementCount: processedCount,
              timestamp: new Date().toISOString(),
            };

            broadcast(JSON.stringify(matchInfo));
            console.log(
              `Broadcast cost match info: ${processedCount} elements matched across ${
                Object.keys(matchedCodes).length
              } EBKPH codes`
            );
          }

          // Send acknowledgment back to client
          ws.send(
            JSON.stringify({
              type: "reapply_costs_response",
              status: "success",
              message: `Successfully applied costs to ${processedCount} elements across ${
                Object.keys(matchedCodes).length
              } EBKPH codes.`,
              matchCount: Object.keys(matchedCodes).length,
              elementCount: processedCount,
            })
          );
        } catch (error) {
          console.error(`Error reapplying costs: ${error}`);
          ws.send(
            JSON.stringify({
              type: "reapply_costs_response",
              status: "error",
              message: `Error reapplying costs: ${error.message}`,
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
            type: "error",
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

            // Parse the QTO element data
            const elementData = JSON.parse(messageValue);

            // Check if we've already processed this element
            const elementId = elementData.element_id || elementData.id;
            if (!elementId || processedElementIds.has(elementId)) {
              // Skip duplicates
              broadcast(messageValue); // Still forward the message to clients
              return;
            }

            // Store the element by EBKPH code for later use
            if (elementData.ebkph) {
              // Normalize EBKPH code
              const ebkpCode = normalizeEbkpCode(elementData.ebkph);

              // Store by EBKPH code
              if (!ifcElementsByEbkph[ebkpCode]) {
                ifcElementsByEbkph[ebkpCode] = [];
              }
              ifcElementsByEbkph[ebkpCode].push(elementData);

              // Also store by project for easier retrieval
              const projectKey = elementData.project || "unknown";
              if (!elementsByProject[projectKey]) {
                elementsByProject[projectKey] = {};
              }
              if (!elementsByProject[projectKey][ebkpCode]) {
                elementsByProject[projectKey][ebkpCode] = [];
              }
              elementsByProject[projectKey][ebkpCode].push(elementData);

              // Mark as processed to avoid duplicates
              processedElementIds.add(elementId);

              console.log(
                `Stored IFC element with EBKPH ${ebkpCode} (element ID: ${elementId})`
              );

              // Save to file periodically (we'll implement this function below)
              scheduleElementSave();
            }

            // If element has an EBKPH code, check if we have a unit cost for it
            if (elementData.ebkph) {
              // Normalize the code for lookup
              const normalizedCode = normalizeEbkpCode(elementData.ebkph);

              // Debug log all available cost codes for comparison
              if (Object.keys(unitCostsByEbkph).length > 0) {
                console.log(
                  `Looking for cost data match for element EBKPH ${elementData.ebkph} (normalized: ${normalizedCode})`
                );
                console.log(
                  `Available cost codes: ${Object.keys(unitCostsByEbkph).join(
                    ", "
                  )}`
                );
              }

              // Find the best match for this code
              const bestMatch = findBestEbkphMatch(normalizedCode);

              if (bestMatch) {
                // Add cost information to the element
                const costInfo = bestMatch.costInfo;
                const area = parseFloat(elementData.area || 0);
                const costUnit = costInfo.cost_unit || 0;

                // Enhanced element with cost data - preserve original structure
                const enhancedElement = {
                  ...elementData, // Keep all original element properties
                  cost_unit: costUnit,
                  cost: costUnit * (area || 1), // Calculate total cost
                  cost_source: costInfo.filename,
                  cost_timestamp: costInfo.timestamp,
                  cost_match_method: bestMatch.method,
                };

                // Make sure EBKPH components are present
                if (costInfo.ebkph1 && !enhancedElement.ebkph1) {
                  enhancedElement.ebkph1 = costInfo.ebkph1;
                }
                if (costInfo.ebkph2 && !enhancedElement.ebkph2) {
                  enhancedElement.ebkph2 = costInfo.ebkph2;
                }
                if (costInfo.ebkph3 && !enhancedElement.ebkph3) {
                  enhancedElement.ebkph3 = costInfo.ebkph3;
                }

                console.log(
                  `MATCH FOUND (${bestMatch.method}): Added cost data to element with EBKPH ${elementData.ebkph} (normalized: ${normalizedCode}): unit cost = ${costUnit}, area = ${area}, total cost = ${enhancedElement.cost}`
                );

                // Send enhanced element to cost topic
                await sendEnhancedElementToKafka(enhancedElement);

                // Also notify clients about this match
                broadcastCostMatch(bestMatch.code, costUnit, 1);
              } else {
                console.log(
                  `No cost data found for EBKPH code ${elementData.ebkph} (normalized: ${normalizedCode})`
                );
              }
            }

            // Forward original message to all connected WebSocket clients
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
  // Create a sample element that matches the expected IFC element format
  return {
    project: "Test Project",
    filename: "test.ifc",
    timestamp: timestamp,
    file_id: `test.ifc_${timestamp}`,
    element_id: "test_element_1",
    category: "ifcwallstandardcase",
    level: "Level_1",
    area: 8.5,
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

// Send enhanced element with cost data to Kafka
async function sendEnhancedElementToKafka(enhancedElement) {
  try {
    // Make sure cost topic exists
    if (!costTopicReady) {
      console.log(`Ensuring cost topic exists: ${config.kafka.costTopic}`);
      costTopicReady = await ensureTopicExists(config.kafka.costTopic);
    }

    // Make sure cost producer is connected
    if (!costProducer.isConnected) {
      console.log("Connecting cost producer to Kafka...");
      await costProducer.connect();
      console.log("Cost producer connected to Kafka");
    }

    // Log what we're sending to help with debugging
    console.log("Sending element to cost topic with structure:", {
      id: enhancedElement.element_id || enhancedElement.id,
      category: enhancedElement.category,
      level: enhancedElement.level,
      ebkph: enhancedElement.ebkph,
      area: enhancedElement.area,
      cost_unit: enhancedElement.cost_unit,
      cost: enhancedElement.cost,
    });

    // Send the enhanced element to Kafka
    const result = await costProducer.send({
      topic: config.kafka.costTopic,
      messages: [
        {
          value: JSON.stringify(enhancedElement),
          key: enhancedElement.element_id || enhancedElement.id,
        },
      ],
    });

    console.log(
      `Enhanced element sent to Kafka topic ${config.kafka.costTopic}`
    );
    return true;
  } catch (error) {
    console.error("Error sending enhanced element to Kafka:", error);
    return false;
  }
}

// Flag to track if cost topic is ready
let costTopicReady = false;

// Handle server shutdown
const shutdown = async () => {
  console.log("Shutting down...");

  // Save elements to file before shutting down
  await saveElementsToFile();

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

  // Load existing elements from file
  loadElementsFromFile();

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

  // Set up periodic save
  setInterval(() => {
    saveElementsToFile();
  }, config.storage.saveInterval);
});

// Normalize EBKPH code (used for matching)
function normalizeEbkpCode(code) {
  if (!code) return code;

  // Convert to uppercase for consistent matching
  const upperCode = code.toUpperCase().trim();

  // Special case handling for common variations
  // Handle patterns like:
  // "C01.01" becomes "C1.1"
  // "C1.1" remains "C1.1"
  // "C01.1" becomes "C1.1"
  // "C1.01" becomes "C1.1"
  // "C01" becomes "C1"
  // "C 1" becomes "C1"
  // "C 1.1" becomes "C1.1"

  // Remove any spaces
  let normalized = upperCode.replace(/\s+/g, "");

  // First try the format with dots
  normalized = normalized.replace(/([A-Z])0*(\d+)\.0*(\d+)/g, "$1$2.$3");

  // Then handle codes without dots
  normalized = normalized.replace(/([A-Z])0*(\d+)$/g, "$1$2");

  // Handle special case "C.1" format (missing number after letter)
  normalized = normalized.replace(/([A-Z])\.(\d+)/g, "$1$2");

  // Debug log
  if (normalized !== upperCode) {
    console.log(`Normalized EBKPH code from ${upperCode} to ${normalized}`);
  }

  return normalized;
}

// Save elements to JSON file
let saveScheduled = false;

function scheduleElementSave() {
  if (!saveScheduled) {
    saveScheduled = true;
    setTimeout(saveElementsToFile, 10000); // Save after 10 seconds of inactivity
  }
}

async function saveElementsToFile() {
  try {
    saveScheduled = false;

    // Check if we have elements to save
    const totalElements = Object.values(ifcElementsByEbkph).reduce(
      (count, elements) => count + elements.length,
      0
    );

    if (totalElements === 0) {
      console.log("No elements to save, skipping file write");
      return;
    }

    console.log(
      `Saving ${totalElements} IFC elements to ${config.storage.elementFile}`
    );

    // Prepare data structure for saving
    const dataToSave = {
      elementsByEbkph: ifcElementsByEbkph,
      elementsByProject: elementsByProject,
      timestamp: new Date().toISOString(),
      elementCount: totalElements,
    };

    // Write to file
    fs.writeFileSync(
      config.storage.elementFile,
      JSON.stringify(dataToSave, null, 2)
    );

    console.log(`Successfully saved ${totalElements} elements to file`);

    // Broadcast element update to all clients
    broadcastElementUpdate();
  } catch (error) {
    console.error("Error saving elements to file:", error);
  }
}

// Load elements from file on startup
function loadElementsFromFile() {
  try {
    if (fs.existsSync(config.storage.elementFile)) {
      console.log(`Loading elements from ${config.storage.elementFile}`);

      const fileData = fs.readFileSync(config.storage.elementFile, "utf8");
      const data = JSON.parse(fileData);

      // Restore the data structures
      if (data.elementsByEbkph) {
        Object.assign(ifcElementsByEbkph, data.elementsByEbkph);
      }

      if (data.elementsByProject) {
        Object.assign(elementsByProject, data.elementsByProject);
      }

      // Rebuild the processed IDs set
      Object.values(ifcElementsByEbkph).forEach((elements) => {
        elements.forEach((element) => {
          const id = element.element_id || element.id;
          if (id) {
            processedElementIds.add(id);
          }
        });
      });

      console.log(`Loaded ${processedElementIds.size} elements from file`);
    } else {
      console.log(
        `Element file ${config.storage.elementFile} not found, starting with empty storage`
      );
    }
  } catch (error) {
    console.error("Error loading elements from file:", error);
    // Continue with empty storage
  }
}

// Add a helper function to send element updates to all clients
function broadcastElementUpdate() {
  const elementInfo = {
    type: "element_update",
    elementCount: processedElementIds.size,
    ebkphCodes:
      Object.keys(ifcElementsByEbkph).length > 20
        ? Object.keys(ifcElementsByEbkph).length + " codes available"
        : Object.keys(ifcElementsByEbkph),
    projects: Object.keys(elementsByProject),
    costCodes:
      Object.keys(unitCostsByEbkph).length > 20
        ? Object.keys(unitCostsByEbkph).length + " codes available"
        : Object.keys(unitCostsByEbkph),
    timestamp: new Date().toISOString(),
  };

  broadcast(JSON.stringify(elementInfo));
  console.log(
    `Broadcast element update: ${processedElementIds.size} elements available`
  );
}

// Add a function to broadcast cost match information for a single code
function broadcastCostMatch(ebkpCode, costUnit, elementCount) {
  const matchInfo = {
    type: "cost_match_info",
    matches: {
      [ebkpCode]: {
        elementCount,
        costUnit,
      },
    },
    matchCount: 1,
    elementCount: elementCount,
    timestamp: new Date().toISOString(),
  };

  broadcast(JSON.stringify(matchInfo));
  console.log(
    `Broadcast cost match for code ${ebkpCode}: ${elementCount} element(s), unit cost = ${costUnit}`
  );
}

// Add this function to find the best match for an EBKP code
function findBestEbkphMatch(normalizedCode) {
  if (!normalizedCode) return null;

  // First, direct match
  if (unitCostsByEbkph[normalizedCode]) {
    return {
      code: normalizedCode,
      costInfo: unitCostsByEbkph[normalizedCode],
      method: "direct",
    };
  }

  // Next, try removing all non-alphanumeric characters
  const cleanedCode = normalizedCode.replace(/[^A-Z0-9]/g, "");
  for (const [costCode, costInfo] of Object.entries(unitCostsByEbkph)) {
    const cleanedCostCode = costCode.replace(/[^A-Z0-9]/g, "");
    if (cleanedCostCode === cleanedCode) {
      return {
        code: costCode,
        costInfo,
        method: "simplified",
      };
    }
  }

  // Try to match just the major segments (like C2 part of C2.1)
  const majorSegmentMatch = normalizedCode.match(/^([A-Z]\d+)/);
  if (majorSegmentMatch && majorSegmentMatch[1]) {
    const majorSegment = majorSegmentMatch[1];

    for (const [costCode, costInfo] of Object.entries(unitCostsByEbkph)) {
      if (
        costCode.startsWith(majorSegment + ".") ||
        costCode === majorSegment
      ) {
        return {
          code: costCode,
          costInfo,
          method: "major-segment",
        };
      }
    }
  }

  return null;
}
