package news_digest

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository provides access to news digests
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository creates a new news digest repository
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Digest represents a news digest from news_db.digests
type Digest struct {
	ID               int64     `json:"id"`
	IndustryIDList   []string  `json:"industry_id_list"`
	Region           *string   `json:"region"`
	City             *string   `json:"city"`
	Country          string    `json:"country"`
	Source           string    `json:"source"`
	Text             string    `json:"text"`
	CreatedAt        time.Time `json:"created_at"`
}

// Create inserts a new digest (from Model A response)
func (r *Repository) Create(ctx context.Context, d *Digest) (int64, error) {
	industryJSON, _ := json.Marshal(d.IndustryIDList)

	query := `
		INSERT INTO digests (industry_id_list, region, city, country, source, text)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at
	`

	err := r.pool.QueryRow(ctx, query,
		industryJSON, d.Region, d.City, d.Country, d.Source, d.Text,
	).Scan(&d.ID, &d.CreatedAt)

	if err != nil {
		return 0, fmt.Errorf("insert digest: %w", err)
	}

	return d.ID, nil
}

// GetLatest returns the N most recent digests
func (r *Repository) GetLatest(ctx context.Context, limit int) ([]Digest, error) {
	query := `
		SELECT id, industry_id_list, region, city, country, source, text, created_at
		FROM digests
		ORDER BY created_at DESC
		LIMIT $1
	`

	rows, err := r.pool.Query(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("query latest digests: %w", err)
	}
	defer rows.Close()

	return r.scanDigests(rows)
}

// GetByIndustries returns digests matching any of the given industry codes
func (r *Repository) GetByIndustries(ctx context.Context, industries []string, limit int) ([]Digest, error) {
	if len(industries) == 0 {
		return r.GetLatest(ctx, limit)
	}

	industryJSON, _ := json.Marshal(industries)

	query := `
		SELECT id, industry_id_list, region, city, country, source, text, created_at
		FROM digests
		WHERE industry_id_list ?| $1
		ORDER BY created_at DESC
		LIMIT $2
	`

	rows, err := r.pool.Query(ctx, query, industryJSON, limit)
	if err != nil {
		return nil, fmt.Errorf("query by industries: %w", err)
	}
	defer rows.Close()

	return r.scanDigests(rows)
}

// GetByRegion returns digests for a specific region
func (r *Repository) GetByRegion(ctx context.Context, region string, limit int) ([]Digest, error) {
	query := `
		SELECT id, industry_id_list, region, city, country, source, text, created_at
		FROM digests
		WHERE region = $1
		ORDER BY created_at DESC
		LIMIT $2
	`

	rows, err := r.pool.Query(ctx, query, region, limit)
	if err != nil {
		return nil, fmt.Errorf("query by region: %w", err)
	}
	defer rows.Close()

	return r.scanDigests(rows)
}

// GetByCountry returns digests for a specific country
func (r *Repository) GetByCountry(ctx context.Context, country string, limit int) ([]Digest, error) {
	query := `
		SELECT id, industry_id_list, region, city, country, source, text, created_at
		FROM digests
		WHERE country = $1
		ORDER BY created_at DESC
		LIMIT $2
	`

	rows, err := r.pool.Query(ctx, query, country, limit)
	if err != nil {
		return nil, fmt.Errorf("query by country: %w", err)
	}
	defer rows.Close()

	return r.scanDigests(rows)
}

// scanDigests scans rows into Digest slice
func (r *Repository) scanDigests(rows interface {
	Next() bool
	Scan(dest ...interface{}) error
	Err() error
	Close()
}) ([]Digest, error) {
	var digests []Digest

	for rows.Next() {
		var d Digest
		var industryJSON []byte

		err := rows.Scan(&d.ID, &industryJSON, &d.Region, &d.City, &d.Country, &d.Source, &d.Text, &d.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan digest: %w", err)
		}

		if len(industryJSON) > 0 {
			_ = json.Unmarshal(industryJSON, &d.IndustryIDList)
		}

		digests = append(digests, d)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}

	return digests, nil
}

// ToModelBNewsDigest converts internal Digest to Model B DTO
func (d *Digest) ToModelBNewsDigest() map[string]interface{} {
	return map[string]interface{}{
		"id":                 d.ID,
		"industry_id_list":   d.IndustryIDList,
		"region":             d.Region,
		"city":               d.City,
		"country":            d.Country,
		"source":             d.Source,
		"text":               d.Text,
		"created_at":         d.CreatedAt.Format(time.RFC3339),
	}
}