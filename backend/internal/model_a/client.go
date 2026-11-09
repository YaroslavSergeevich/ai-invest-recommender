package model_a

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"backend/internal/config"
)

// Client is an HTTP client for Model A service
type Client struct {
	httpClient *http.Client
	baseURL    string
}

// NewClient creates a new Model A client
func NewClient(cfg config.ModelAConfig) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: 60 * time.Second, // Model A may take time for processing
		},
		baseURL: cfg.URL,
	}
}

// Request represents the request to Model A
type Request struct {
	RawText    string `json:"raw_text"`
	SourceURL  string `json:"source_url"`
	SourceName string `json:"source_name"`
}

// Response represents the response from Model A
type Response struct {
	ID               *int64   `json:"id"`                 // always null from Model A
	IndustryIDList   []string `json:"industry_id_list"`
	Region           *string  `json:"region"`             // region code or null
	City             *string  `json:"city"`               // city or null
	Country          string   `json:"country"`            // e.g., "США (US)"
	Source           string   `json:"source"`             // e.g., "РБК"
	Text             string   `json:"text"`               // digest content
}

// ProcessNews sends raw news to Model A and returns structured digest
func (c *Client) ProcessNews(ctx context.Context, req Request) (*Response, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("model A returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var modelAResp Response
	if err := json.Unmarshal(respBody, &modelAResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	return &modelAResp, nil
}