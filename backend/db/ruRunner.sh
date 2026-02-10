#!/bin/bash

# Set the path to your project
PROJECT_DIR="/home/ec2-user/carrot-on-cloud/backend/db"
LOG_DIR="/home/ec2-user/logs"
LOG_FILE="$LOG_DIR/cron-$(date +\%Y-\%m-\%d).log"

# Create logs directory if it doesn't exist
mkdir -p $LOG_DIR

# Log start time
echo "=== Cron job started at $(date) ===" >> $LOG_FILE

# Navigate to project directory
cd $PROJECT_DIR

# Run the Node.js script
/usr/bin/node ru.js >> $LOG_FILE 2>&1

# Log completion
echo "=== Cron job completed at $(date) ===" >> $LOG_FILE
echo "" >> $LOG_FILE

# Optional: Keep only last 7 days of logs
find $LOG_DIR -name "cron-*.log" -mtime +7 -delete