const WebSocket = require("ws");
const http = require("http");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const MongoDBHelper = require("./mongodb");

// Load environment variables
dotenv.config();

// Configuration
const config = {
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

// Initialize MongoDB
const mongodb = new MongoDBHelper();
let isMongoDBConnected = false;

console.log("Starting WebSocket server with configuration:", {
  websocketPort: config.websocket.port,
  elementFile: config.storage.elementFile,
});

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
        mongodb: isMongoDBConnected ? "CONNECTED" : "DISCONNECTED",
        clients: clients.size,
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

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Set();

// Function to broadcast message to all connected clients
function broadcast(message) {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Function to process a new element
async function processNewElement(elementId) {
  try {
    // Get element from MongoDB
    const element = await mongodb.getElement(elementId);
    if (!element) {
      console.error(`Element not found in MongoDB: ${elementId}`);
      return;
    }

    // Check if element was already processed
    if (processedElementIds.has(elementId)) {
      console.log(`Element ${elementId} was already processed`);
      return;
    }

    // Process the element
    const enhancedElement = await enhanceElementWithCost(element);
    if (enhancedElement) {
      // Save cost data to MongoDB
      const costDataId = await mongodb.saveCostData({
        element_id: elementId,
        unit_cost: enhancedElement.cost_unit,
        total_cost: enhancedElement.cost,
        calculation_date: new Date(),
        calculation_method: "standard",
        metadata: {
          ebkph: enhancedElement.ebkph,
          category: enhancedElement.category,
          level: enhancedElement.level,
          area: enhancedElement.area,
        },
      });

      if (costDataId) {
        // Update local storage
        processedElementIds.add(elementId);
        ifcElementsByEbkph[enhancedElement.ebkph] = enhancedElement;

        // Update project storage
        if (!elementsByProject[enhancedElement.project]) {
          elementsByProject[enhancedElement.project] = [];
        }
        elementsByProject[enhancedElement.project].push(enhancedElement);

        // Broadcast the enhanced element to all connected clients
        broadcast(
          JSON.stringify({
            type: "element_updated",
            element: enhancedElement,
          })
        );
      }
    }
  } catch (error) {
    console.error(`Error processing element ${elementId}:`, error);
  }
}

// Function to enhance element with cost data
async function enhanceElementWithCost(element) {
  try {
    if (!element || !element.ebkph) {
      console.error("Invalid element or missing EBKPH code:", element);
      return null;
    }

    // Normalize the EBKPH code for matching
    const normalizedCode = normalizeEbkpCode(element.ebkph);
    console.log(`Processing element with EBKPH code: ${normalizedCode}`);

    // Find the best matching cost code
    const costMatch = findBestEbkphMatch(normalizedCode);
    if (!costMatch) {
      console.log(`No cost match found for EBKPH code: ${normalizedCode}`);
      return null;
    }

    // Get the cost information
    const costInfo = costMatch.costInfo;
    console.log(`Found cost match for ${normalizedCode}:`, costInfo);

    // Calculate costs
    const area = element.area || 0;
    const unitCost = costInfo.cost_unit || 0;
    const totalCost = area * unitCost;

    // Create enhanced element with cost data
    const enhancedElement = {
      ...element,
      cost_unit: unitCost,
      cost: totalCost,
      cost_code: costMatch.code,
      cost_match_method: costMatch.method,
      normalized_ebkph: normalizedCode,
      original_ebkph: element.ebkph,
      calculation_date: new Date().toISOString(),
    };

    // Log the enhancement results
    console.log(`Enhanced element ${element.element_id}:`, {
      area,
      unitCost,
      totalCost,
      ebkph: element.ebkph,
      normalizedCode,
      costCode: costMatch.code,
    });

    return enhancedElement;
  } catch (error) {
    console.error("Error enhancing element with cost:", error);
    return null;
  }
}

// WebSocket connection handler
wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`New client connected. Total clients: ${clients.size}`);

  // Send initial connection status
  ws.send(
    JSON.stringify({
      type: "connection_status",
      status: "CONNECTED",
      mongodb: isMongoDBConnected ? "CONNECTED" : "DISCONNECTED",
    })
  );

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.eventType === "ELEMENT_CREATED") {
        // Process the new element
        await processNewElement(data.payload.elementId);
      }
    } catch (error) {
      console.error("Error processing message:", error);
      ws.send(JSON.stringify({ type: "error", message: error.message }));
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`Client disconnected. Total clients: ${clients.size}`);
  });
});

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

  // Close MongoDB connection
  try {
    await mongodb.close();
    console.log("MongoDB connection closed");
  } catch (error) {
    console.error("Error closing MongoDB connection:", error);
  }

  // Close HTTP server
  server.close();

  process.exit(0);
};

// Start the server
server.listen(config.websocket.port, async () => {
  console.log(`WebSocket server started on port ${config.websocket.port}`);

  // Load existing elements from file
  loadElementsFromFile();

  // Initialize MongoDB connection
  isMongoDBConnected = await mongodb.initialize();
  if (isMongoDBConnected) {
    console.log("MongoDB connection established");
    broadcast(JSON.stringify({ type: "mongodb_status", status: "CONNECTED" }));
  } else {
    console.error("Failed to connect to MongoDB");
    broadcast(
      JSON.stringify({ type: "mongodb_status", status: "DISCONNECTED" })
    );
  }

  // Set up periodic save
  setInterval(() => {
    saveElementsToFile();
  }, config.storage.saveInterval);
});

// Handle process termination
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

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
