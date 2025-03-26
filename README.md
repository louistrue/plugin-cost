# Plugin-Cost with MongoDB Integration

A cost calculation plugin for building elements, allowing extraction of cost data from Excel files and applying it to BIM elements. This plugin is part of the NHM (Nachhaltiges Holz Modeler) ecosystem.

## Features

- **WebSocket Backend**: Real-time communication with frontend
- **Kafka Integration**: Receives elements from QTO plugin and publishes cost calculations
- **Excel Upload**: Import unit costs from Excel files
- **MongoDB Integration**: Persistent storage of cost data
- **Cost Calculation**: Automatically calculate costs based on element areas and unit costs
- **Project Summaries**: Calculate and store project-level cost summaries

## Architecture

![Architecture Diagram](https://mermaid.ink/img/pako:eNqNkl1rwjAUhv9KyVUHGtqaD9crmdOxIbSbDnZRSJpTjW2ykmTMIv73JbVurLDtKuQ9z3nenJyEYZ1xwASWwKygFBGzaLrFb_bK3vAOl9V1y1g32q3DQVJVxeHcJnfbfLu77NuMfJVCf1KNZ5bPJFcO9zCfKsmEBHSyuuIW1RMPM7ApLa5FjA7opQBbMw28sdjAD2FIeQQ8aTEsqSg1pE9pI4GGgBTjDpikpwSHMJUcnlILJXLCmjIU8h0QwVXFoBBDO-d6XchgDiqgEYvZnhzq9Zz7CxUQzD_aEZ_QLvtgxHJD2Aq0OY34BwxQoEY2jHIFpPUURiBXQd8DdyQ-B--xtw9fDnx1WG4aUGOgGDWnCazwk9wP4XQj5eHXr4a-jK8PXrHWfeSLHjnX0Zx01JYCqzyYi7wP9bFwC4l0oZSAEoEXO4EGPD5LU-kDPH5UOd9SfJJa6X8eGSsVc9Ks6xOmfkG6hs0JYgJXbCPBtE-D3-iLCVGb8JIJqbFgwjbTlMT2bkJyP76hzNYkBvpjI5fUXULUt8c?type=png)

## Installation

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for development)

### Setup

The plugin-cost module is designed to integrate with the main NHM docker-compose environment. It relies on the shared MongoDB and Kafka services defined in the root docker-compose.yml.

1. Ensure the main docker-compose.yml includes the cost-websocket and cost-frontend services
2. Run the entire NHM environment:

```bash
cd _NHMzh
docker-compose up -d
```

For local development outside Docker:

```bash
cd plugin-cost
npm install
npm run dev

cd socket-backend
npm install
npm run dev
```

### Kafka Topic Setup

This plugin requires several Kafka topics to be created. Use the provided scripts to create them:

**Linux/macOS:**

```bash
# Make the script executable
chmod +x setup-kafka.sh
# Run the setup script
./setup-kafka.sh
```

**Windows:**

```cmd
# Run the Windows batch file
setup-kafka.bat
```

These scripts will automatically find the Kafka broker container, copy the topic creation script into it, and execute it.

## MongoDB Integration

The plugin uses the shared MongoDB instance for persistent storage of cost data. The following collections are created in the `cost` database:

- `costData`: Stores cost calculations for each building element
- `costSummaries`: Stores aggregated cost data per project

### Schema Design

Cost Data schema:

```javascript
{
  element_id: ObjectId,     // Reference to element in QTO database
  project_id: ObjectId,     // Reference to project in QTO database
  unit_cost: Number,        // Cost per unit area
  total_cost: Number,       // Total cost for the element
  currency: String,         // Currency (default: CHF)
  calculation_date: Date,   // When cost was calculated
  calculation_method: String, // How cost was calculated
  metadata: {
    ebkp_code: String,      // EBKP classification code
    source: String          // Source of the cost data
  }
}
```

Cost Summary schema:

```javascript
{
  project_id: ObjectId,     // Reference to project
  total_cost: Number,       // Total project cost
  breakdown: [              // Breakdown by EBKP category
    {
      category: String,     // EBKP category (e.g., "C")
      cost: Number          // Total cost for this category
    }
  ],
  created_at: Date,         // When summary was created
  calculation_parameters: {
    method: String,         // Calculation method
    currency: String        // Currency
  }
}
```

## API Endpoints

The WebSocket backend provides the following HTTP endpoints:

- `GET /` or `/health`: Health check and status
- `GET /elements`: List of all elements
- `GET /elements/ebkph/:code`: Elements filtered by EBKP code
- `GET /elements/project/:id`: Elements filtered by project
- `GET /project-cost/:id`: Cost summary for a project
- `GET /element-cost/:id`: Cost data for a specific element
- `GET /costs`: Available unit costs
- `GET /reapply_costs`: Recalculate costs for all elements

## WebSocket Events

The WebSocket server handles the following events:

- `connection`: Sent when client connects
- `unit_costs`: Client uploads cost data from Excel
- `cost_match_info`: Server informs about cost matches
- `element_update`: Server informs about new elements
- `cost_data_response`: Server response to Excel upload

## Integration with other plugins

- Receives elements from the QTO Plugin via Kafka
- Sends cost calculations to the LCA Plugin via Kafka
- Stores and retrieves data from the shared MongoDB instance

## License

This project is licensed under the terms of the MIT license.
