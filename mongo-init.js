// MongoDB initialization script

// Connect to admin database
db = db.getSiblingDB("admin");

// Create admin user
db.createUser({
  user: "admin_user",
  pwd: "admin_password",
  roles: [
    { role: "userAdminAnyDatabase", db: "admin" },
    { role: "dbAdminAnyDatabase", db: "admin" },
    { role: "readWriteAnyDatabase", db: "admin" },
  ],
});

// Create databases and collections
const databases = ["qto", "cost", "lca", "shared"];

databases.forEach((dbName) => {
  db = db.getSiblingDB(dbName);

  if (dbName === "qto") {
    // Create collections for QTO
    db.createCollection("projects");
    db.createCollection("elements");

    // Create indexes
    db.elements.createIndex({ project_id: 1 });
    db.elements.createIndex({ element_type: 1 });
  } else if (dbName === "cost") {
    // Create collections for Cost
    db.createCollection("costData");
    db.createCollection("costSummaries");

    // Create indexes
    db.costData.createIndex({ element_id: 1 });
    db.costSummaries.createIndex({ project_id: 1 });
  } else if (dbName === "lca") {
    // Create collections for LCA
    db.createCollection("lcaResults");
    db.createCollection("materialLibrary");

    // Create indexes
    db.lcaResults.createIndex({ element_id: 1 });
    db.materialLibrary.createIndex({ name: 1 });
  } else if (dbName === "shared") {
    // Create shared collections
    db.createCollection("references");

    // Create indexes
    db.references.createIndex({ reference_type: 1 });
  }
});

// Create service-specific users
db = db.getSiblingDB("admin");

// QTO service user
db.createUser({
  user: "qto_service",
  pwd: "secure_password_qto",
  roles: [
    { role: "readWrite", db: "qto" },
    { role: "read", db: "shared" },
  ],
});

// Cost service user
db.createUser({
  user: "cost_service",
  pwd: "secure_password_cost",
  roles: [
    { role: "readWrite", db: "cost" },
    { role: "read", db: "qto" },
    { role: "read", db: "shared" },
  ],
});

// LCA service user
db.createUser({
  user: "lca_service",
  pwd: "secure_password_lca",
  roles: [
    { role: "readWrite", db: "lca" },
    { role: "read", db: "cost" },
    { role: "read", db: "qto" },
    { role: "read", db: "shared" },
  ],
});

// Print initialization complete message
print(
  "MongoDB initialization completed: databases, collections, and users created."
);
