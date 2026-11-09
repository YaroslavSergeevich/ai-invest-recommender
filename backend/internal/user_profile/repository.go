package user_profile

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"backend/internal/model_b"
)

// Repository provides access to company and group profiles
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository creates a new user profile repository
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Company represents a company profile from users_db.companies
type Company struct {
	SyntheticU             string   `json:"synthetic_u"`
	OrgType                string   `json:"org_type"`
	OKFSName               string   `json:"okfs_name"`
	CompanyAgeYearsGradation string `json:"company_age_years_gradation"`
	EcoMarkLabel           string   `json:"eco_mark_label"`
	MainOKVEDCode          string   `json:"mainokved_code"`
	MainOKVEDName          string   `json:"mainokved_name"`
	AmountWorkersFNSGradation string `json:"amount_workers_fns_gradation"`
	CLType                 string   `json:"cl_type"`
	CLProductRKOMark       bool     `json:"cl_product_rko_mark"`
	CLProductGARMark       bool     `json:"cl_product_gar_mark"`
	CLProductLOAMark       bool     `json:"cl_product_loa_mark"`
	CLProductLEAMark       bool     `json:"cl_product_lea_mark"`
	CLProductDEPMark       bool     `json:"cl_product_dep_mark"`
	CLProductZPPMark       bool     `json:"cl_product_zpp_mark"`
	FTSCountryName         string   `json:"fts_country_name"`
	FactoringMark          bool     `json:"factoring_mark"`
	RevenueCompany         int64    `json:"revenue_company"`
	GroupID                string   `json:"group_id"`
	City                   string   `json:"city"`
	Region                 string   `json:"region"`
	BusinessSizeFNS        string   `json:"business_size_fns"`
	AdditionalSectors      []string `json:"additional_sectors"`
}

// Group represents a group profile from users_db.groups
type Group struct {
	GroupID             string   `json:"group_id"`
	TargetCompanyIDs    []string `json:"target_company_ids"`
	RevenueSum          int64    `json:"revenue_sum"`
	BusinessSizeBank    string   `json:"business_size_bank"`
	OwnSectors          []string `json:"own_sectors"`
	MainOKVEDCodes      []string `json:"mainokved_codes"`
	Regions             []string `json:"regions"`
	Cities              []string `json:"cities"`
	FTSCountries        []string `json:"fts_countries"`
	OwnershipForms      []string `json:"ownership_forms"`
	DevelopmentStages   []string `json:"development_stages"`
	MainOKVEDNames      map[string][]string `json:"mainokved_names"`
	AdditionalSectors   []string `json:"additional_sectors"`
}

// FullProfile combines company and group data for Model B prompt
type FullProfile struct {
	Company *Company `json:"company"`
	Group   *Group   `json:"group,omitempty"`
}

// GetCompany retrieves a company by synthetic_u
func (r *Repository) GetCompany(ctx context.Context, syntheticU string) (*Company, error) {
	query := `
		SELECT synthetic_u, org_type, okfs_name, company_age_years_gradation, eco_mark_label,
		       mainokved_code, mainokved_name, amount_workers_fns_gradation, cl_type,
		       cl_product_rko_mark, cl_product_gar_mark, cl_product_loa_mark,
		       cl_product_lea_mark, cl_product_dep_mark, cl_product_zpp_mark,
		       fts_country_name, factoring_mark, revenue_company, group_id,
		       city, region, business_size_fns, additional_sectors
		FROM companies
		WHERE synthetic_u = $1
	`

	var c Company
	var additionalSectorsJSON []byte

	err := r.pool.QueryRow(ctx, query, syntheticU).Scan(
		&c.SyntheticU, &c.OrgType, &c.OKFSName, &c.CompanyAgeYearsGradation, &c.EcoMarkLabel,
		&c.MainOKVEDCode, &c.MainOKVEDName, &c.AmountWorkersFNSGradation, &c.CLType,
		&c.CLProductRKOMark, &c.CLProductGARMark, &c.CLProductLOAMark,
		&c.CLProductLEAMark, &c.CLProductDEPMark, &c.CLProductZPPMark,
		&c.FTSCountryName, &c.FactoringMark, &c.RevenueCompany, &c.GroupID,
		&c.City, &c.Region, &c.BusinessSizeFNS, &additionalSectorsJSON,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("company not found: %s", syntheticU)
	}
	if err != nil {
		return nil, fmt.Errorf("query company: %w", err)
	}

	if len(additionalSectorsJSON) > 0 {
		_ = json.Unmarshal(additionalSectorsJSON, &c.AdditionalSectors)
	}

	return &c, nil
}

// GetGroup retrieves a group by group_id
func (r *Repository) GetGroup(ctx context.Context, groupID string) (*Group, error) {
	query := `
		SELECT group_id, target_company_ids, revenue_sum, business_size_bank,
		       own_sectors, mainokved_codes, regions, cities, fts_countries,
		       ownership_forms, development_stages, mainokved_names, additional_sectors
		FROM groups
		WHERE group_id = $1
	`

	var g Group
	var targetCompanyIDsJSON, ownSectorsJSON, mainOKVEDCodesJSON, regionsJSON, citiesJSON []byte
	var ftsCountriesJSON, ownershipFormsJSON, developmentStagesJSON, mainOKVEDNamesJSON, additionalSectorsJSON []byte

	err := r.pool.QueryRow(ctx, query, groupID).Scan(
		&g.GroupID, &targetCompanyIDsJSON, &g.RevenueSum, &g.BusinessSizeBank,
		&ownSectorsJSON, &mainOKVEDCodesJSON, &regionsJSON, &citiesJSON,
		&ftsCountriesJSON, &ownershipFormsJSON, &developmentStagesJSON,
		&mainOKVEDNamesJSON, &additionalSectorsJSON,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("group not found: %s", groupID)
	}
	if err != nil {
		return nil, fmt.Errorf("query group: %w", err)
	}

	_ = json.Unmarshal(targetCompanyIDsJSON, &g.TargetCompanyIDs)
	_ = json.Unmarshal(ownSectorsJSON, &g.OwnSectors)
	_ = json.Unmarshal(mainOKVEDCodesJSON, &g.MainOKVEDCodes)
	_ = json.Unmarshal(regionsJSON, &g.Regions)
	_ = json.Unmarshal(citiesJSON, &g.Cities)
	_ = json.Unmarshal(ftsCountriesJSON, &g.FTSCountries)
	_ = json.Unmarshal(ownershipFormsJSON, &g.OwnershipForms)
	_ = json.Unmarshal(developmentStagesJSON, &g.DevelopmentStages)
	_ = json.Unmarshal(mainOKVEDNamesJSON, &g.MainOKVEDNames)
	_ = json.Unmarshal(additionalSectorsJSON, &g.AdditionalSectors)

	return &g, nil
}

// GetFullProfile retrieves company with its group data
func (r *Repository) GetFullProfile(ctx context.Context, syntheticU string) (*FullProfile, error) {
	company, err := r.GetCompany(ctx, syntheticU)
	if err != nil {
		return nil, err
	}

	profile := &FullProfile{Company: company}

	if company.GroupID != "" {
		group, err := r.GetGroup(ctx, company.GroupID)
		if err != nil {
			// Log warning but don't fail - group is optional enrichment
			// In production, use a logger here
			profile.Group = nil
		} else {
			profile.Group = group
		}
	}

	return profile, nil
}

// ToModelBCompanyProfile converts internal Company to Model B CompanyProfile struct
func (c *Company) ToModelBCompanyProfile() *model_b.CompanyProfile {
	return &model_b.CompanyProfile{
		SyntheticU:                c.SyntheticU,
		OrgType:                   c.OrgType,
		OKFSName:                  c.OKFSName,
		CompanyAgeYearsGradation:  c.CompanyAgeYearsGradation,
		EcoMarkLabel:              c.EcoMarkLabel,
		MainOKVEDCode:             c.MainOKVEDCode,
		MainOKVEDName:             c.MainOKVEDName,
		AmountWorkersFNSGradation: c.AmountWorkersFNSGradation,
		CLType:                    c.CLType,
		CLProductRKOMark:          &c.CLProductRKOMark,
		CLProductGARMark:          &c.CLProductGARMark,
		CLProductLOAMark:          &c.CLProductLOAMark,
		CLProductLEAMark:          &c.CLProductLEAMark,
		CLProductDEPMark:          &c.CLProductDEPMark,
		CLProductZPPMark:          &c.CLProductZPPMark,
		FTSCountryName:            c.FTSCountryName,
		FactoringMark:             &c.FactoringMark,
		RevenueCompany:            &c.RevenueCompany,
		GroupID:                   c.GroupID,
		City:                      c.City,
		Region:                    c.Region,
		BusinessSizeFNS:           c.BusinessSizeFNS,
		AdditionalSectors:         c.AdditionalSectors,
	}
}

// ToModelBGroupProfile converts internal Group to Model B GroupProfile struct
func (g *Group) ToModelBGroupProfile() *model_b.GroupProfile {
	return &model_b.GroupProfile{
		GroupID:             g.GroupID,
		TargetCompanyIDs:    g.TargetCompanyIDs,
		RevenueSum:          &g.RevenueSum,
		BusinessSizeBank:    g.BusinessSizeBank,
		OwnSectors:          g.OwnSectors,
		MainOKVEDCodes:      g.MainOKVEDCodes,
		Regions:             g.Regions,
		Cities:              g.Cities,
		FTSCountries:        g.FTSCountries,
		OwnershipForms:      g.OwnershipForms,
		DevelopmentStages:   g.DevelopmentStages,
		MainOKVEDNames:      g.MainOKVEDNames,
		AdditionalSectors:   g.AdditionalSectors,
	}
}