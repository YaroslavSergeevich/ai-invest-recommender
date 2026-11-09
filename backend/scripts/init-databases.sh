#!/bin/bash
# Initialize databases for users_db and news_db
# Runs as postgres entrypoint init script

set -e

echo "Creating databases: users_db, news_db"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
	CREATE DATABASE users_db;
	CREATE DATABASE news_db;
	GRANT ALL PRIVILEGES ON DATABASE users_db TO postgres;
	GRANT ALL PRIVILEGES ON DATABASE news_db TO postgres;
EOSQL

echo "Databases created successfully"