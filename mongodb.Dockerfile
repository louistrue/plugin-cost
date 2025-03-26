FROM mongo:6.0

# Add MongoDB initialization script
COPY ./mongo-init.js /docker-entrypoint-initdb.d/

# Set default command
CMD ["mongod", "--auth"]

# Expose MongoDB port
EXPOSE 27017 