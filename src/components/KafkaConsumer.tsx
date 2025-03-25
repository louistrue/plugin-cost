import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Snackbar,
  Alert,
} from "@mui/material";

interface Material {
  name: string;
  fraction: number;
  volume: number;
}

interface Classification {
  id: string;
  name: string;
  system: string;
}

interface QTOMessage {
  project: string;
  filename: string;
  timestamp: string;
  file_id: string;
  element_id: string;
  category: string;
  level: string;
  area: number;
  is_structural: boolean;
  is_external: boolean;
  ebkph: string;
  materials: Material[];
  classification: Classification;
  cost_unit?: number;
  cost?: number;
  cost_code?: string;
  cost_match_method?: string;
  normalized_ebkph?: string;
  original_ebkph?: string;
  calculation_date?: string;
}

interface ElementCreatedEvent {
  eventType: string;
  timestamp: string;
  producer: string;
  payload: {
    projectId: string;
    elementId: string;
    elementType: string;
  };
  metadata: {
    version: string;
    correlationId: string;
  };
}

const KafkaConsumer = () => {
  const [messages, setMessages] = useState<QTOMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    const connectToWebSocket = () => {
      setLoading(true);
      setError(null);

      const websocket = new WebSocket("ws://localhost:8001");

      websocket.onopen = () => {
        console.log("WebSocket connected");
        setConnected(true);
        setLoading(false);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "element_updated") {
            // Handle element update message
            setMessages((prevMessages) =>
              [...prevMessages, data.element].slice(-10)
            );
          } else if (data.type === "connection_status") {
            // Handle connection status message
            console.log("Connection status:", data.status);
          }
        } catch (err) {
          console.error("Failed to parse message:", err);
          setError("Failed to parse message");
        }
      };

      websocket.onerror = (error) => {
        console.error("WebSocket error:", error);
        setError("WebSocket connection error");
        setConnected(false);
        setLoading(false);
      };

      websocket.onclose = () => {
        console.log("WebSocket disconnected");
        setConnected(false);
        setLoading(false);
      };

      setWs(websocket);

      return () => {
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.close();
        }
      };
    };

    const cleanup = connectToWebSocket();
    return cleanup;
  }, []);

  // Group messages by project and file
  const groupedMessages = messages.reduce<Record<string, QTOMessage[]>>(
    (acc, message) => {
      const key = `${message.project}-${message.filename}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(message);
      return acc;
    },
    {}
  );

  if (loading) {
    return <div>Connecting to WebSocket server...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          QTO Elements Monitor
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              bgcolor: connected ? "success.main" : "error.main",
              mr: 1,
            }}
          />
          <Typography>
            Status:{" "}
            {loading
              ? "Connecting..."
              : connected
              ? "Connected"
              : "Disconnected"}
          </Typography>
          {loading && <CircularProgress size={20} sx={{ ml: 2 }} />}
        </Box>

        {messages.length > 0 && (
          <>
            {Object.entries(groupedMessages).map(([key, projectMessages]) => (
              <Box key={key} sx={{ mb: 4 }}>
                <Typography variant="h6" gutterBottom>
                  Project: {projectMessages[0].project}
                </Typography>
                <Typography variant="body1" gutterBottom>
                  File: {projectMessages[0].filename}
                </Typography>
                <Typography variant="body1" gutterBottom>
                  Elements Received: {projectMessages.length}
                </Typography>
                <Typography variant="body1" gutterBottom>
                  Latest Timestamp:{" "}
                  {new Date(
                    projectMessages[projectMessages.length - 1].timestamp
                  ).toLocaleString()}
                </Typography>

                <Box sx={{ mt: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    Cost Summary:
                  </Typography>
                  {projectMessages.some((msg) => msg.cost !== undefined) ? (
                    <>
                      <Typography variant="body2">
                        Total Area:{" "}
                        {projectMessages
                          .reduce((sum, msg) => sum + (msg.area || 0), 0)
                          .toFixed(2)}{" "}
                        m²
                      </Typography>
                      <Typography variant="body2">
                        Total Cost:{" "}
                        {projectMessages
                          .reduce((sum, msg) => sum + (msg.cost || 0), 0)
                          .toFixed(2)}{" "}
                        €
                      </Typography>
                      <Typography variant="body2">
                        Average Unit Cost:{" "}
                        {(
                          projectMessages.reduce(
                            (sum, msg) => sum + (msg.cost_unit || 0),
                            0
                          ) / projectMessages.length
                        ).toFixed(2)}{" "}
                        €/m²
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No cost data available yet
                    </Typography>
                  )}
                </Box>

                <Box sx={{ mt: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    Elements by Category:
                  </Typography>
                  {Object.entries(
                    projectMessages.reduce((acc, msg) => {
                      if (msg.category) {
                        if (!acc[msg.category]) {
                          acc[msg.category] = {
                            count: 0,
                            totalArea: 0,
                            totalCost: 0,
                            elements: [],
                          };
                        }
                        acc[msg.category].count++;
                        acc[msg.category].totalArea += msg.area || 0;
                        acc[msg.category].totalCost += msg.cost || 0;
                        acc[msg.category].elements.push(msg);
                      }
                      return acc;
                    }, {} as Record<string, { count: number; totalArea: number; totalCost: number; elements: QTOMessage[] }>)
                  ).map(([category, data]) => (
                    <Box key={category} sx={{ mb: 1 }}>
                      <Typography variant="body2">
                        {category}: {data.count} elements
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Area: {data.totalArea.toFixed(2)} m²
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Cost: {data.totalCost.toFixed(2)} €
                      </Typography>
                    </Box>
                  ))}
                </Box>

                <Box sx={{ mt: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    Elements by Classification:
                  </Typography>
                  {Object.entries(
                    projectMessages.reduce((acc, msg) => {
                      if (msg.classification?.id) {
                        if (!acc[msg.classification.id]) {
                          acc[msg.classification.id] = {
                            count: 0,
                            totalArea: 0,
                            totalCost: 0,
                            elements: [],
                          };
                        }
                        acc[msg.classification.id].count++;
                        acc[msg.classification.id].totalArea += msg.area || 0;
                        acc[msg.classification.id].totalCost += msg.cost || 0;
                        acc[msg.classification.id].elements.push(msg);
                      }
                      return acc;
                    }, {} as Record<string, { count: number; totalArea: number; totalCost: number; elements: QTOMessage[] }>)
                  ).map(([id, data]) => (
                    <Box key={id} sx={{ mb: 1 }}>
                      <Typography variant="body2">
                        {id}: {data.count} elements
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Area: {data.totalArea.toFixed(2)} m²
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Cost: {data.totalCost.toFixed(2)} €
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}
          </>
        )}

        {messages.length === 0 && !loading && connected && (
          <Typography>Waiting for elements from database...</Typography>
        )}
      </Paper>

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError(null)}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default KafkaConsumer;
