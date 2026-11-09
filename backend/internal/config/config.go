package config

import (
	"strconv"

	"github.com/spf13/viper"
)

// Config holds all configuration for the backend service
type Config struct {
	// Server
	Port string `mapstructure:"PORT"`

	// PostgreSQL
	PostgresHost     string `mapstructure:"POSTGRES_HOST"`
	PostgresPort     int    `mapstructure:"POSTGRES_PORT"`
	PostgresUser     string `mapstructure:"POSTGRES_USER"`
	PostgresPassword string `mapstructure:"POSTGRES_PASSWORD"`
	UsersDB          string `mapstructure:"USERS_DB"`
	NewsDB           string `mapstructure:"NEWS_DB"`

	// Model A (external service)
	ModelAURL   string `mapstructure:"MODEL_A_URL"`

	// Model B (external API)
	ModelBBaseURL string `mapstructure:"MODEL_B_BASE_URL"`
	ModelBAPIKey  string `mapstructure:"MODEL_B_API_KEY"`
	ModelBModel   string `mapstructure:"MODEL_B_MODEL"`

	// Daemon
	DaemonPollInterval    int    `mapstructure:"DAEMON_POLL_INTERVAL"`
	DaemonSourcesConfig   string `mapstructure:"DAEMON_SOURCES_CONFIG"`
}

// Load reads configuration from .env file and environment variables
func Load() (*Config, error) {
	v := viper.New()

	// Set defaults
	v.SetDefault("PORT", "8080")
	v.SetDefault("POSTGRES_PORT", 5432)
	v.SetDefault("USERS_DB", "users_db")
	v.SetDefault("NEWS_DB", "news_db")
	v.SetDefault("MODEL_B_BASE_URL", "https://changellenge.up.railway.app/v1")
	v.SetDefault("DAEMON_POLL_INTERVAL", 300)
	v.SetDefault("DAEMON_SOURCES_CONFIG", "./daemon/sources.yaml")

	// Read from .env file
	v.SetConfigName(".env")
	v.SetConfigType("env")
	v.AddConfigPath(".")               // current directory
	v.AddConfigPath("./backend")       // backend subdirectory
	v.AddConfigPath("/app")            // docker container
	v.AutomaticEnv()                   // override with env vars

	// Try to read config file (optional - env vars may be enough)
	_ = v.ReadInConfig()

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	// Validate required fields
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// Validate checks that all required configuration is present
func (c *Config) Validate() error {
	required := map[string]string{
		"POSTGRES_HOST":     c.PostgresHost,
		"POSTGRES_USER":     c.PostgresUser,
		"POSTGRES_PASSWORD": c.PostgresPassword,
		"MODEL_A_URL":       c.ModelAURL,
		"MODEL_B_API_KEY":   c.ModelBAPIKey,
		"MODEL_B_MODEL":     c.ModelBModel,
		"DAEMON_SOURCES_CONFIG": c.DaemonSourcesConfig,
	}

	for key, value := range required {
		if value == "" {
			return &ConfigError{Field: key, Message: "required but not set"}
		}
	}
	return nil
}

// ConfigError represents a configuration validation error
type ConfigError struct {
	Field   string
	Message string
}

func (e *ConfigError) Error() string {
	return "config: " + e.Field + " - " + e.Message
}

// UsersDSN returns the DSN for users_db connection
func (c *Config) UsersDSN() string {
	return c.pgDSN(c.UsersDB)
}

// NewsDSN returns the DSN for news_db connection
func (c *Config) NewsDSN() string {
	return c.pgDSN(c.NewsDB)
}

func (c *Config) pgDSN(dbName string) string {
	return "postgres://" + c.PostgresUser + ":" + c.PostgresPassword + "@" +
		c.PostgresHost + ":" + strconv.Itoa(c.PostgresPort) + "/" + dbName + "?sslmode=disable"
}

// ModelAConfig returns Model A client configuration
func (c *Config) ModelAConfig() ModelAConfig {
	return ModelAConfig{
		URL: c.ModelAURL,
	}
}

// ModelBConfig returns Model B client configuration
func (c *Config) ModelBConfig() ModelBConfig {
	return ModelBConfig{
		BaseURL: c.ModelBBaseURL,
		APIKey:  c.ModelBAPIKey,
		Model:   c.ModelBModel,
	}
}

// ModelAConfig holds Model A specific configuration
type ModelAConfig struct {
	URL string
}

// ModelBConfig holds Model B specific configuration
type ModelBConfig struct {
	BaseURL string
	APIKey  string
	Model   string
}