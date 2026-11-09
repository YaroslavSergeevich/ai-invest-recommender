package model_b

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

// Client is an HTTP client for Model B API
type Client struct {
	httpClient *http.Client
	baseURL    string
	apiKey     string
	model      string
}

// NewClient creates a new Model B client
func NewClient(cfg config.ModelBConfig) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: 120 * time.Second, // Model B may take longer for reasoning
		},
		baseURL: cfg.BaseURL,
		apiKey:  cfg.APIKey,
		model:   cfg.Model,
	}
}

// CompanyProfile represents the company/profile context for Model B
type CompanyProfile struct {
	// Company fields (from users_db.companies)
	SyntheticU           string   `json:"synthetic_u,omitempty"`
	OrgType              string   `json:"org_type,omitempty"`
	OKFSName             string   `json:"okfs_name,omitempty"`
	CompanyAgeYearsGradation string `json:"company_age_years_gradation,omitempty"`
	EcoMarkLabel         string   `json:"eco_mark_label,omitempty"`
	MainOKVEDCode        string   `json:"mainokved_code,omitempty"`
	MainOKVEDName        string   `json:"mainokved_name,omitempty"`
	AmountWorkersFNSGradation string `json:"amount_workers_fns_gradation,omitempty"`
	CLType               string   `json:"cl_type,omitempty"`
	CLProductRKOMark     *bool    `json:"cl_product_rko_mark,omitempty"`
	CLProductGARMark     *bool    `json:"cl_product_gar_mark,omitempty"`
	CLProductLOAMark     *bool    `json:"cl_product_loa_mark,omitempty"`
	CLProductLEAMark     *bool    `json:"cl_product_lea_mark,omitempty"`
	CLProductDEPMark     *bool    `json:"cl_product_dep_mark,omitempty"`
	CLProductZPPMark     *bool    `json:"cl_product_zpp_mark,omitempty"`
	FTSCountryName       string   `json:"fts_country_name,omitempty"`
	FactoringMark        *bool    `json:"factoring_mark,omitempty"`
	RevenueCompany       *int64   `json:"revenue_company,omitempty"`
	GroupID              string   `json:"group_id,omitempty"`
	City                 string   `json:"city,omitempty"`
	Region               string   `json:"region,omitempty"`
	BusinessSizeFNS      string   `json:"business_size_fns,omitempty"`
	AdditionalSectors    []string `json:"additional_sectors,omitempty"`

	// Group fields (from users_db.groups) - optional, populated when available
	Group *GroupProfile `json:"group,omitempty"`
}

// GroupProfile represents group-level context
type GroupProfile struct {
	GroupID             string   `json:"group_id,omitempty"`
	TargetCompanyIDs    []string `json:"target_company_ids,omitempty"`
	RevenueSum          *int64   `json:"revenue_sum,omitempty"`
	BusinessSizeBank    string   `json:"business_size_bank,omitempty"`
	OwnSectors          []string `json:"own_sectors,omitempty"`
	MainOKVEDCodes      []string `json:"mainokved_codes,omitempty"`
	Regions             []string `json:"regions,omitempty"`
	Cities              []string `json:"cities,omitempty"`
	FTSCountries        []string `json:"fts_countries,omitempty"`
	OwnershipForms      []string `json:"ownership_forms,omitempty"`
	DevelopmentStages   []string `json:"development_stages,omitempty"`
	MainOKVEDNames      map[string][]string `json:"mainokved_names,omitempty"`
	AdditionalSectors   []string `json:"additional_sectors,omitempty"`
}

// NewsDigest represents a news digest from news_db
type NewsDigest struct {
	ID               int64    `json:"id"`
	IndustryIDList   []string `json:"industry_id_list"`
	Region           *string  `json:"region"`
	City             *string  `json:"city"`
	Country          string   `json:"country"`
	Source           string   `json:"source"`
	Text             string   `json:"text"`
	CreatedAt        string   `json:"created_at"` // RFC3339
}

// PushRequest represents the request for push endpoint
type PushRequest struct {
	CompanyProfile CompanyProfile `json:"company_profile"`
	NewsDigests    []NewsDigest   `json:"news_digests"`
	UserQuery      *string        `json:"user_query"` // always null for push
}

// ChatRequest represents the request for chat endpoint
type ChatRequest struct {
	CompanyProfile CompanyProfile `json:"company_profile"`
	NewsDigests    []NewsDigest   `json:"news_digests"`
	UserQuery      *string        `json:"user_query"` // optional for chat
}

// PushResponse represents the response from push endpoint
type PushResponse struct {
	PushFlag bool   `json:"push_flag"`
	Text     string `json:"text"`
}

// ChatResponse represents the response from chat endpoint
type ChatResponse struct {
	Text string `json:"text"`
}

// doRequest performs HTTP request to Model B API
func (c *Client) doRequest(ctx context.Context, endpoint string, reqBody, respBody interface{}) error {
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	url := c.baseURL + endpoint
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("model B returned status %d: %s", resp.StatusCode, string(respBytes))
	}

	if err := json.Unmarshal(respBytes, respBody); err != nil {
		return fmt.Errorf("unmarshal response: %w", err)
	}

	return nil
}

// Push sends push request to Model B
func (c *Client) Push(ctx context.Context, req PushRequest) (*PushResponse, error) {
	var resp PushResponse
	err := c.doRequest(ctx, "/push", req, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// Chat sends chat request to Model B
func (c *Client) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	var resp ChatResponse
	err := c.doRequest(ctx, "/chat", req, &resp)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}