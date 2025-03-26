const { MongoClient, ObjectId } = require("mongodb");
const dotenv = require("dotenv");

// Ensure environment variables are loaded
dotenv.config();

// MongoDB connection URI - use environment variable if available
const uri =
  process.env.MONGODB_URI ||
  "mongodb://admin:secure_password@mongodb:27017/?authSource=admin";

// Database names
const costDbName = process.env.MONGODB_DATABASE || "cost";
const qtoDbName = "qto";
const sharedDbName = "shared";

// MongoDB client instance
let client = null;
let costDb = null;
let qtoDb = null;
let sharedDb = null;
let connectionRetries = 0;
const MAX_RETRIES = 5;

/**
 * Initialize the MongoDB connection
 */
async function connectToMongoDB() {
  try {
    // Create a new MongoClient if one doesn't exist
    if (!client) {
      console.log("Connecting to MongoDB at mongodb:27017");

      client = new MongoClient(uri, {
        connectTimeoutMS: 5000,
        serverSelectionTimeoutMS: 5000,
        retryWrites: true,
        retryReads: true,
      });

      await client.connect();
      console.log("Successfully connected to MongoDB");

      // Get database references
      costDb = client.db(costDbName);
      qtoDb = client.db(qtoDbName);
      sharedDb = client.db(sharedDbName);

      console.log(
        `Using databases: cost=${costDbName}, qto=${qtoDbName}, shared=${sharedDbName}`
      );

      // Create collections if they don't exist
      await initializeCollections();
    }

    return {
      client,
      costDb,
      qtoDb,
      sharedDb,
    };
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    // Reset client so we can try again later
    client = null;
    costDb = null;
    qtoDb = null;
    sharedDb = null;
    throw error;
  }
}

/**
 * Initialize collections and create indexes
 */
async function initializeCollections() {
  try {
    // Check if collections exist first
    const costCollections = await costDb.listCollections().toArray();
    const costCollectionNames = costCollections.map((c) => c.name);

    // Create CostData collection if it doesn't exist
    if (!costCollectionNames.includes("costData")) {
      await costDb.createCollection("costData");
      console.log("Created costData collection");
    }

    // Create CostSummaries collection if it doesn't exist
    if (!costCollectionNames.includes("costSummaries")) {
      await costDb.createCollection("costSummaries");
      console.log("Created costSummaries collection");
    }

    // Create indexes (idempotent operation - safe to run if they already exist)
    await costDb.collection("costData").createIndex({ element_id: 1 });
    await costDb.collection("costSummaries").createIndex({ project_id: 1 });

    console.log("MongoDB collections initialized");
  } catch (error) {
    console.error("Error initializing collections:", error);
    throw error;
  }
}

/**
 * Close the MongoDB connection
 */
async function closeMongoDB() {
  if (client) {
    try {
      await client.close();
      console.log("MongoDB connection closed");
    } catch (error) {
      console.error("Error closing MongoDB connection:", error);
    } finally {
      client = null;
      costDb = null;
      qtoDb = null;
      sharedDb = null;
    }
  }
}

/**
 * Ensure the connection is established before any operation
 */
async function ensureConnection() {
  if (!client) {
    await connectToMongoDB();
  } else {
    try {
      // Test the connection by running a simple command
      await client.db("admin").command({ ping: 1 });
    } catch (error) {
      console.error("MongoDB connection error, reconnecting:", error);
      await closeMongoDB();

      // Try to reconnect with the same retry logic as in connectToMongoDB
      try {
        await connectToMongoDB();
      } catch (reconnectError) {
        console.error("Failed to reconnect to MongoDB:", reconnectError);
        throw new Error(
          `Database connection failed: ${reconnectError.message}`
        );
      }
    }
  }
}

/**
 * Save cost data for an element
 */
async function saveCostData(elementData, costResult) {
  await ensureConnection();

  try {
    // Generate new ObjectIds if not provided
    const elementId = elementData._id
      ? new ObjectId(elementData._id)
      : new ObjectId();
    const projectId = elementData.project_id
      ? new ObjectId(elementData.project_id)
      : new ObjectId();

    // First, save the element data to the qto database
    const elementDoc = {
      _id: elementId,
      project_id: projectId,
      ebkp_code: elementData.ebkp_code,
      area: elementData.area || 0,
      volume: elementData.volume || 0,
      length: elementData.length || 0,
      metadata: elementData.metadata || {},
      created_at: new Date(),
      updated_at: new Date(),
    };

    console.log(
      `Saving element data to qto.elements: ${JSON.stringify(elementDoc)}`
    );

    // Upsert the element document
    await qtoDb.collection("elements").updateOne(
      { _id: elementId },
      {
        $set: elementDoc,
        $setOnInsert: { created_at: new Date() },
        $currentDate: { updated_at: true },
      },
      { upsert: true }
    );

    // Now save the cost data to the cost database
    const costData = {
      element_id: elementId,
      project_id: projectId,
      unit_cost: costResult.unitCost || 0,
      total_cost: costResult.totalCost || 0,
      currency: costResult.currency || "CHF",
      calculation_date: new Date(),
      calculation_method: costResult.method || "excel-import",
      metadata: {
        ebkp_code: elementData.ebkp_code,
        source: "plugin-cost",
        ...elementData.metadata,
      },
      created_at: new Date(),
      updated_at: new Date(),
    };

    console.log(
      `Saving cost data to cost.costData: ${JSON.stringify(costData)}`
    );

    // Using upsert to update if exists or insert if not
    const result = await costDb.collection("costData").updateOne(
      { element_id: elementId },
      {
        $set: costData,
        $setOnInsert: { created_at: new Date() },
        $currentDate: { updated_at: true },
      },
      { upsert: true }
    );

    // Update the project cost summary
    await updateProjectCostSummary(projectId);

    return { elementId, projectId, result };
  } catch (error) {
    console.error("Error saving cost data:", error);
    throw error; // Throw the error to handle it in the calling function
  }
}

/**
 * Get element data from QTO database
 */
async function getQtoElement(elementId) {
  await ensureConnection();

  try {
    return await qtoDb.collection("elements").findOne({
      _id: new ObjectId(elementId),
    });
  } catch (error) {
    console.error("Error getting QTO element:", error);
    return null;
  }
}

/**
 * Get elements by project ID
 */
async function getElementsByProject(projectId) {
  await ensureConnection();

  try {
    return await qtoDb
      .collection("elements")
      .find({
        project_id: new ObjectId(projectId),
      })
      .toArray();
  } catch (error) {
    console.error("Error getting elements by project:", error);
    return [];
  }
}

/**
 * Get cost data for an element
 */
async function getCostDataForElement(elementId) {
  await ensureConnection();

  try {
    return await costDb.collection("costData").findOne({
      element_id: new ObjectId(elementId),
    });
  } catch (error) {
    console.error("Error getting cost data for element:", error);
    return null;
  }
}

/**
 * Update project cost summary
 */
async function updateProjectCostSummary(projectId) {
  await ensureConnection();

  try {
    // Handle ObjectId conversion safely
    let projectObjId;
    try {
      projectObjId =
        typeof projectId === "string" ? new ObjectId(projectId) : projectId;
    } catch (error) {
      console.error(`Invalid project ID format: ${projectId}`, error);
      return { error: `Invalid project ID format: ${projectId}` };
    }

    // Get all cost data for the project
    const costData = await costDb
      .collection("costData")
      .find({
        project_id: projectObjId,
      })
      .toArray();

    if (costData.length === 0) {
      console.log(`No cost data found for project ${projectId}`);
      return {
        project_id: projectId,
        total_cost: 0,
        breakdown: [],
        created_at: new Date(),
        message: "No cost data found for this project",
      };
    }

    // Calculate total cost
    const totalCost = costData.reduce(
      (sum, item) => sum + (item.total_cost || 0),
      0
    );

    // Create breakdown by category/type
    const breakdown = {};
    for (const item of costData) {
      const category = item.metadata?.ebkp_code?.substring(0, 1) || "Other";
      breakdown[category] = (breakdown[category] || 0) + (item.total_cost || 0);
    }

    // Update or create summary
    const summary = {
      project_id: projectId.toString(),
      total_cost: totalCost,
      breakdown: Object.entries(breakdown).map(([category, cost]) => ({
        category,
        cost,
      })),
      created_at: new Date(),
      calculation_parameters: {
        method: "sum",
        currency: "CHF",
      },
    };

    const result = await costDb
      .collection("costSummaries")
      .updateOne(
        { project_id: projectObjId },
        { $set: summary },
        { upsert: true }
      );

    return summary;
  } catch (error) {
    console.error("Error updating project cost summary:", error);
    return { error: `Failed to update project summary: ${error.message}` };
  }
}

/**
 * Get all elements for a project
 */
async function getAllElementsForProject(projectName) {
  await ensureConnection();

  try {
    console.log(`Looking up project elements by name: ${projectName}`);
    let elements = [];

    // First, check if qtoDb has a projects collection where we can find the project ID
    try {
      const projectsCollection = await qtoDb
        .listCollections({ name: "projects" })
        .toArray();

      if (projectsCollection.length > 0) {
        // Projects collection exists in QTO database
        const project = await qtoDb.collection("projects").findOne({
          name: { $regex: new RegExp(`^${projectName}$`, "i") },
        });

        if (project) {
          console.log(
            `Found project in QTO database: ${project.name}, ID: ${project._id}`
          );

          // Look up elements using the project ID
          elements = await qtoDb
            .collection("elements")
            .find({
              project_id: project._id,
            })
            .toArray();

          console.log(
            `Found ${elements.length} elements using project ID ${project._id}`
          );
        }
      } else {
        console.log(
          "No projects collection in QTO database, trying shared database"
        );
      }
    } catch (error) {
      console.warn(
        `Error checking for projects collection in QTO database: ${error.message}`
      );
    }

    // If we didn't find elements through the project ID, try looking for elements with project_name field
    if (elements.length === 0) {
      // Look for elements with project_name field
      elements = await qtoDb
        .collection("elements")
        .find({
          project_name: { $regex: new RegExp(projectName, "i") },
        })
        .toArray();

      console.log(
        `Found ${elements.length} elements by project_name field search`
      );
    }

    // If still no elements, try looking for elements with name field in properties
    if (elements.length === 0) {
      elements = await qtoDb
        .collection("elements")
        .find({
          "properties.project_name": { $regex: new RegExp(projectName, "i") },
        })
        .toArray();

      console.log(
        `Found ${elements.length} elements by properties.project_name field search`
      );
    }

    // If still no elements, check all collections in QTO database for elements related to this project
    if (elements.length === 0) {
      console.log(
        "No elements found, dumping available collections and sample documents to debug"
      );

      // Get list of all collections in QTO database
      const collections = await qtoDb.listCollections().toArray();
      console.log(
        `Available collections in QTO database: ${collections
          .map((c) => c.name)
          .join(", ")}`
      );

      // Sample a document from each collection to understand their structure
      for (const collection of collections) {
        const sampleDoc = await qtoDb.collection(collection.name).findOne({});
        if (sampleDoc) {
          console.log(
            `Sample document from ${collection.name}:`,
            JSON.stringify(sampleDoc, (key, value) =>
              key === "_id" ? value.toString() : value
            ).substring(0, 200) + "..."
          );
        }
      }

      return [];
    }

    // Get cost data for these elements
    const elementIds = elements.map((e) => e._id);
    const costData = await costDb
      .collection("costData")
      .find({
        element_id: { $in: elementIds },
      })
      .toArray();

    console.log(
      `Found ${costData.length} cost data entries for project elements`
    );

    // Create a map of cost data by element ID for quick lookup
    const costDataMap = {};
    costData.forEach((cost) => {
      costDataMap[cost.element_id.toString()] = cost;
    });

    // Enhance elements with cost data
    const enhancedElements = elements.map((element) => {
      const elementId = element._id.toString();
      const cost = costDataMap[elementId];

      return {
        ...element,
        cost_data: cost
          ? {
              unit_cost: cost.unit_cost,
              total_cost: cost.total_cost,
              currency: cost.currency,
              calculation_date: cost.calculation_date,
            }
          : null,
      };
    });

    return enhancedElements;
  } catch (error) {
    console.error("Error getting all elements for project:", error);
    return [];
  }
}

/**
 * Save cost data in batch
 */
async function saveCostDataBatch(costItems, projectName) {
  try {
    await ensureConnection();
    console.log(
      `Starting batch save for project: ${projectName}, ${costItems.length} items`
    );

    if (!costItems || costItems.length === 0) {
      console.warn("No cost items provided to save");
      return { insertedCount: 0, message: "No items to save" };
    }

    // First check if the projects collection exists, create it if needed
    const collections = await costDb
      .listCollections({ name: "projects" })
      .toArray();
    if (collections.length === 0) {
      console.log("Creating projects collection as it doesn't exist");
      await costDb.createCollection("projects");
    }

    // Declare projectId variable that will be set in the following code
    let projectId;

    try {
      // First, save or get project
      console.log(`Looking up or creating project: ${projectName}`);
      const result = await costDb.collection("projects").findOneAndUpdate(
        { name: projectName },
        {
          $setOnInsert: {
            name: projectName,
            created_at: new Date(),
          },
          $set: {
            updated_at: new Date(),
          },
        },
        { upsert: true, returnDocument: "after" }
      );

      console.log(
        `findOneAndUpdate result:`,
        JSON.stringify(result, null, 2).substring(0, 200)
      );

      // Handle various result formats from different MongoDB driver versions
      if (result && result.value && result.value._id) {
        // MongoDB driver returned { value: { _id: ... } }
        projectId = result.value._id;
        console.log(`Found project via result.value._id: ${projectId}`);
      } else if (result && result._id) {
        // MongoDB driver returned the document directly
        projectId = result._id;
        console.log(`Found project via result._id: ${projectId}`);
      } else if (
        result &&
        result.lastErrorObject &&
        result.lastErrorObject.upserted
      ) {
        // MongoDB driver returned upserted ID in lastErrorObject
        projectId = result.lastErrorObject.upserted;
        console.log(
          `Found project via result.lastErrorObject.upserted: ${projectId}`
        );
      } else {
        // No valid ID format found in the result, create project manually
        throw new Error(
          "Could not extract project ID from findOneAndUpdate result"
        );
      }
    } catch (error) {
      // Fallback: Create project directly if findOneAndUpdate didn't work
      console.error(`Error finding/creating project: ${error.message}`);
      console.log("Creating project manually as fallback");

      projectId = new ObjectId();
      const insertResult = await costDb.collection("projects").insertOne({
        _id: projectId,
        name: projectName,
        created_at: new Date(),
        updated_at: new Date(),
      });

      if (insertResult.acknowledged) {
        console.log(`Created new project with ID: ${projectId}`);
      } else {
        throw new Error("Failed to create project");
      }
    }

    // Prepare cost items for batch insert
    const costDataToSave = costItems.map((item) => {
      // Convert properties to ensure they are numbers if they should be
      const kennwert = parseFloat(item.cost_unit || item.kennwert || 0);
      const menge = parseFloat(item.menge || item.area || 0);
      const totalCost = parseFloat(
        item.totalChf || item.cost || kennwert * menge || 0
      );

      return {
        project_id: projectId,
        ebkp_code: item.id || item.ebkph,
        category: item.category || item.bezeichnung || "",
        level: item.level || "",
        unit_cost: kennwert,
        quantity: menge,
        total_cost: totalCost,
        currency: "CHF",
        metadata: {
          source: "excel-import",
          timestamp: new Date(),
          original_data: {
            einheit: item.einheit || "m²",
            kommentar: item.kommentar || "",
            fromKafka: item.fromKafka || false,
            kafkaSource: item.kafkaSource || null,
            kafkaTimestamp: item.kafkaTimestamp || null,
          },
        },
        created_at: new Date(),
        updated_at: new Date(),
      };
    });

    // Log what we're about to save
    console.log(`Prepared ${costDataToSave.length} cost items for saving`);
    if (costDataToSave.length > 0) {
      console.log(`Sample item: ${JSON.stringify(costDataToSave[0], null, 2)}`);
    }

    // Delete existing cost data for this project
    console.log(`Deleting existing cost data for project ${projectId}`);
    const deleteResult = await costDb
      .collection("costData")
      .deleteMany({ project_id: projectId });
    console.log(`Deleted ${deleteResult.deletedCount} existing cost items`);

    // Insert new cost data
    if (costDataToSave.length > 0) {
      console.log(
        `Inserting ${costDataToSave.length} cost items for project ${projectId}`
      );
      const result = await costDb
        .collection("costData")
        .insertMany(costDataToSave);
      console.log(`Successfully inserted ${result.insertedCount} cost items`);

      // Now create/update corresponding element records in the QTO database
      console.log(`Creating/updating element records in QTO database`);

      // Process in batches to prevent memory issues
      const BATCH_SIZE = 20;
      for (let i = 0; i < costDataToSave.length; i += BATCH_SIZE) {
        const batch = costDataToSave.slice(i, i + BATCH_SIZE);
        const elementOps = batch.map((costItem) => {
          // Create a basic element for each cost item
          const elementId = new ObjectId();
          return {
            updateOne: {
              filter: {
                ebkp_code: costItem.ebkp_code,
                project_id: costItem.project_id,
              },
              update: {
                $set: {
                  quantity: costItem.quantity,
                  element_type: costItem.category,
                  properties: {
                    level: costItem.level,
                    ebkph: costItem.ebkp_code,
                    is_structural: true,
                    is_external: false,
                  },
                  status: "active",
                  updated_at: new Date(),
                },
                $setOnInsert: {
                  _id: elementId,
                  created_at: new Date(),
                },
              },
              upsert: true,
            },
          };
        });

        // Execute bulk operation
        const bulkResult = await qtoDb
          .collection("elements")
          .bulkWrite(elementOps);
        console.log(
          `Batch ${i / BATCH_SIZE + 1}: ${
            bulkResult.upsertedCount
          } elements inserted, ${bulkResult.modifiedCount} elements updated`
        );
      }

      // Update project summary
      await updateProjectCostSummary(projectId);
      return result;
    }

    return { insertedCount: 0, message: "No items to save" };
  } catch (error) {
    console.error("Error saving cost data batch:", error);
    throw error;
  }
}

module.exports = {
  connectToMongoDB,
  closeMongoDB,
  saveCostData,
  getQtoElement,
  getElementsByProject,
  getCostDataForElement,
  updateProjectCostSummary,
  getAllElementsForProject,
  saveCostDataBatch,
  ObjectId,
};
