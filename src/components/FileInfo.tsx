// Function to send cost data to server with better timeout handling
const sendCostDataToServer = async (costData) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket connection not available");
  }

  const messageId = `cost_${Date.now()}${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  // Add messageId to the data
  const message = {
    type: "cost_data",
    messageId,
    data: costData,
  };

  // Send the message
  ws.send(JSON.stringify(message));
  console.log("Cost data sent to server");

  // Wait for response with a longer timeout (30 seconds)
  const responsePromise = new Promise((resolve, reject) => {
    const responseHandler = (event) => {
      try {
        const response = JSON.parse(event.data);

        // Check if this is the response for our message
        if (
          response.type === "cost_data_response" &&
          response.messageId === messageId
        ) {
          ws.removeEventListener("message", responseHandler);
          clearTimeout(timeoutId);

          if (response.status === "success") {
            resolve(response);
          } else {
            reject(new Error(response.message || "Error saving cost data"));
          }
        }
      } catch (error) {
        // Ignore parse errors from other messages
      }
    };

    // Add the event listener
    ws.addEventListener("message", responseHandler);

    // Set a timeout of 30 seconds
    const timeoutId = setTimeout(() => {
      ws.removeEventListener("message", responseHandler);
      reject(new Error("Response timeout"));
    }, 30000);
  });

  // Add event listener to handle connection closure
  const closePromise = new Promise((resolve, reject) => {
    const closeHandler = () => {
      reject(new Error("WebSocket connection closed before response"));
    };

    ws.addEventListener("close", closeHandler);

    // Clean up when responsePromise resolves or rejects
    responsePromise
      .finally(() => {
        ws.removeEventListener("close", closeHandler);
      })
      .catch(() => {}); // Prevent unhandled promise rejection
  });

  // Return whichever promise resolves/rejects first
  return Promise.race([responsePromise, closePromise]);
};

// Similar updates for requestCodeMatching function
