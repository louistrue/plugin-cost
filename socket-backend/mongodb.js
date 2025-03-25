const { MongoClient, ObjectId } = require("mongodb");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

class MongoDBHelper {
  constructor(uri = null, dbName = null, maxRetries = 3, retryDelay = 2000) {
    this.uri =
      uri ||
      process.env.MONGODB_URI ||
      "mongodb://admin:secure_password@mongodb:27017";
    this.dbName = dbName || process.env.MONGODB_DATABASE || "cost";
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;
    this.client = null;
    this.db = null;
    this.qtoDb = null; // Connection to QTO database
  }

  async initialize() {
    let retries = 0;
    while (retries <= this.maxRetries) {
      try {
        // Create MongoDB client
        this.client = new MongoClient(this.uri);

        // Test connection
        await this.client.connect();

        // Get databases
        this.db = this.client.db(this.dbName);
        this.qtoDb = this.client.db("qto"); // Connect to QTO database

        console.log(
          `MongoDB connection initialized successfully to databases ${this.dbName} and qto`
        );

        // Ensure collections exist
        await this._ensureCollections();
        return true;
      } catch (error) {
        retries++;
        if (retries <= this.maxRetries) {
          console.warn(
            `Failed to connect to MongoDB (attempt ${retries}/${this.maxRetries}): ${error}`
          );
          console.log(`Retrying in ${this.retryDelay / 1000} seconds...`);
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
        } else {
          console.error(
            `Failed to connect to MongoDB after ${this.maxRetries} attempts: ${error}`
          );
          return false;
        }
      }
    }
  }

  async _ensureCollections() {
    try {
      // Check if collections exist, create them if not
      const collections = await this.db.listCollections().toArray();
      const collectionNames = collections.map((col) => col.name);

      // CostData collection
      if (!collectionNames.includes("costData")) {
        console.log("Creating costData collection");
        await this.db.createCollection("costData");
        await this.db.collection("costData").createIndex({ element_id: 1 });
      }

      // CostSummaries collection
      if (!collectionNames.includes("costSummaries")) {
        console.log("Creating costSummaries collection");
        await this.db.createCollection("costSummaries");
        await this.db
          .collection("costSummaries")
          .createIndex({ project_id: 1 });
      }
    } catch (error) {
      console.error(`Error ensuring collections: ${error}`);
    }
  }

  async getElement(elementId) {
    try {
      const objId = new ObjectId(elementId);
      const element = await this.qtoDb
        .collection("elements")
        .findOne({ _id: objId });
      return element;
    } catch (error) {
      console.error(`Error getting element from MongoDB: ${error}`);
      return null;
    }
  }

  async saveCostData(costData) {
    try {
      // Add timestamps if they don't exist
      if (!costData.created_at) {
        costData.created_at = new Date();
      }
      costData.updated_at = new Date();

      // Convert element_id to ObjectId if it's a string
      if (costData.element_id && typeof costData.element_id === "string") {
        costData.element_id = new ObjectId(costData.element_id);
      }

      const result = await this.db.collection("costData").insertOne(costData);
      console.log(`Inserted cost data: ${result.insertedId}`);
      return result.insertedId;
    } catch (error) {
      console.error(`Error saving cost data to MongoDB: ${error}`);
      return null;
    }
  }

  async saveCostSummary(costSummary) {
    try {
      // Add timestamps if they don't exist
      if (!costSummary.created_at) {
        costSummary.created_at = new Date();
      }
      costSummary.updated_at = new Date();

      // Convert project_id to ObjectId if it's a string
      if (
        costSummary.project_id &&
        typeof costSummary.project_id === "string"
      ) {
        costSummary.project_id = new ObjectId(costSummary.project_id);
      }

      const result = await this.db
        .collection("costSummaries")
        .insertOne(costSummary);
      console.log(`Inserted cost summary: ${result.insertedId}`);
      return result.insertedId;
    } catch (error) {
      console.error(`Error saving cost summary to MongoDB: ${error}`);
      return null;
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
      console.log("MongoDB connection closed");
    }
  }
}

module.exports = MongoDBHelper;
