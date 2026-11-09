package db

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"runtime"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // for golang-migrate
)

// Pools holds connection pools for both databases
type Pools struct {
	Users *pgxpool.Pool
	News  *pgxpool.Pool
}

// NewPools creates connection pools for users_db and news_db
func NewPools(usersDSN, newsDSN string) (*Pools, error) {
	usersPool, err := createPool(usersDSN)
	if err != nil {
		return nil, fmt.Errorf("users_db: %w", err)
	}

	newsPool, err := createPool(newsDSN)
	if err != nil {
		usersPool.Close()
		return nil, fmt.Errorf("news_db: %w", err)
	}

	return &Pools{
		Users: usersPool,
		News:  newsPool,
	}, nil
}

func createPool(dsn string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	// Pool settings
	config.MaxConns = 20
	config.MinConns = 2

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	// Test connection
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	return pool, nil
}

// Close closes both connection pools
func (p *Pools) Close() {
	if p.Users != nil {
		p.Users.Close()
	}
	if p.News != nil {
		p.News.Close()
	}
}

// RunMigrations applies database migrations from the migrations directory
func RunMigrations(usersDSN, newsDSN string) error {
	// Get the directory of this file to find migrations
	_, filename, _, _ := runtime.Caller(0)
	migrationsDir := filepath.Join(filepath.Dir(filename), "..", "..", "migrations")

	// Run migrations for users_db
	if err := runMigrationsForDB(usersDSN, migrationsDir); err != nil {
		return fmt.Errorf("users_db migrations: %w", err)
	}

	// Run migrations for news_db
	if err := runMigrationsForDB(newsDSN, migrationsDir); err != nil {
		return fmt.Errorf("news_db migrations: %w", err)
	}

	return nil
}

func runMigrationsForDB(dsn, migrationsDir string) error {
	// golang-migrate uses database/sql, so we need a sql.DB
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("open sql: %w", err)
	}
	defer sqlDB.Close()

	driver, err := postgres.WithInstance(sqlDB, &postgres.Config{})
	if err != nil {
		return fmt.Errorf("create driver: %w", err)
	}

	m, err := migrate.NewWithDatabaseInstance(
		"file://"+migrationsDir,
		"postgres", driver)
	if err != nil {
		return fmt.Errorf("create migrate instance: %w", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("apply migrations: %w", err)
	}

	return nil
}