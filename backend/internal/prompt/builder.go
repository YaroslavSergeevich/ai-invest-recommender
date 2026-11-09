package prompt

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"backend/internal/model_b"
	"backend/internal/news_digest"
	"backend/internal/user_profile"
)

// Builder constructs prompts for Model B
type Builder struct {
	maxDigests int // maximum number of digests to include
}

// NewBuilder creates a new prompt builder
func NewBuilder(maxDigests int) *Builder {
	if maxDigests <= 0 {
		maxDigests = 20 // default
	}
	return &Builder{maxDigests: maxDigests}
}

// MaxDigests returns the maximum number of digests to include in prompt
func (b *Builder) MaxDigests() int {
	return b.maxDigests
}

// BuildPushPrompt creates the prompt for push endpoint
func (b *Builder) BuildPushPrompt(profile *user_profile.FullProfile, digests []news_digest.Digest) (model_b.PushRequest, error) {
	companyProfile := profile.Company.ToModelBCompanyProfile()

	// Add group if available
	if profile.Group != nil {
		companyProfile.Group = profile.Group.ToModelBGroupProfile()
	}

	// Convert digests
	modelBDigests := make([]model_b.NewsDigest, 0, len(digests))
	for i, d := range digests {
		if i >= b.maxDigests {
			break
		}
		modelBDigests = append(modelBDigests, model_b.NewsDigest{
			ID:               d.ID,
			IndustryIDList:   d.IndustryIDList,
			Region:           d.Region,
			City:             d.City,
			Country:          d.Country,
			Source:           d.Source,
			Text:             d.Text,
			CreatedAt:        d.CreatedAt.Format(time.RFC3339),
		})
	}

	return model_b.PushRequest{
		CompanyProfile: *companyProfile,
		NewsDigests:    modelBDigests,
		UserQuery:      nil, // always null for push
	}, nil
}

// BuildChatPrompt creates the prompt for chat endpoint
func (b *Builder) BuildChatPrompt(profile *user_profile.FullProfile, digests []news_digest.Digest, userQuery string) (model_b.ChatRequest, error) {
	companyProfile := profile.Company.ToModelBCompanyProfile()

	if profile.Group != nil {
		companyProfile.Group = profile.Group.ToModelBGroupProfile()
	}

	modelBDigests := make([]model_b.NewsDigest, 0, len(digests))
	for i, d := range digests {
		if i >= b.maxDigests {
			break
		}
		modelBDigests = append(modelBDigests, model_b.NewsDigest{
			ID:               d.ID,
			IndustryIDList:   d.IndustryIDList,
			Region:           d.Region,
			City:             d.City,
			Country:          d.Country,
			Source:           d.Source,
			Text:             d.Text,
			CreatedAt:        d.CreatedAt.Format(time.RFC3339),
		})
	}

	var query *string
	if strings.TrimSpace(userQuery) != "" {
		query = &userQuery
	}

	return model_b.ChatRequest{
		CompanyProfile: *companyProfile,
		NewsDigests:    modelBDigests,
		UserQuery:      query,
	}, nil
}

// SystemPrompt returns the system prompt for Model B
func SystemPrompt() string {
	return `Ты — эксперт аналитического центра. Твоя задача — дать персонализированный бизнес-инсайт для руководителя крупного бизнеса (выручка > 15 млрд руб).

ПРИНЦИПЫ РАБОТЫ:
1. НЕ пересказывай новость — интерпретируй её влияние на конкретный бизнес клиента
2. Используй контекст компании: отрасль, 규모, фин. продукты, география, финансовые связи, группа компаний
3. Выделяй: риски, возможности, конкретные действия, позицию
4. Связывай выводы с источниками: данные клиента, новости, аналитика
5. Отвечай на русском языке, структурированно и по делу

ФОРМАТ ОТВЕТА (JSON):
{
  "push_flag": true/false,  // только для push: есть ли значимая новость
  "text": "персонализированный инсайт..."
}

Для chat — возвращай только { "text": "..." } без push_flag.`
}

// FormatDigestsForPrompt formats digests into readable text for prompt context
func FormatDigestsForPrompt(digests []news_digest.Digest) string {
	if len(digests) == 0 {
		return "Нет доступных новостей."
	}

	var sb strings.Builder
	sb.WriteString("ДОСТУПНЫЕ НОВОСТИ (от новых к старым):\n\n")

	for i, d := range digests {
		sb.WriteString(fmt.Sprintf("%d. [%s] %s\n", i+1, d.Source, d.CreatedAt.Format("02.01.2006")))
		if d.Country != "" {
			sb.WriteString(fmt.Sprintf("   Страна: %s", d.Country))
			if d.Region != nil {
				sb.WriteString(fmt.Sprintf(", Регион: %s", *d.Region))
			}
			if d.City != nil {
				sb.WriteString(fmt.Sprintf(", Город: %s", *d.City))
			}
			sb.WriteString("\n")
		}
		if len(d.IndustryIDList) > 0 {
			sb.WriteString(fmt.Sprintf("   Отрасли: %s\n", strings.Join(d.IndustryIDList, ", ")))
		}
		sb.WriteString(fmt.Sprintf("   %s\n\n", d.Text))
	}

	return sb.String()
}

// FormatCompanyProfileForPrompt formats company profile for prompt context
func FormatCompanyProfileForPrompt(profile *user_profile.FullProfile) string {
	c := profile.Company
	var sb strings.Builder

	sb.WriteString("ПРОФИЛЬ КОМПАНИИ:\n")
	sb.WriteString(fmt.Sprintf("- ID: %s\n", c.SyntheticU))
	sb.WriteString(fmt.Sprintf("- Отрасль: %s (%s)\n", c.MainOKVEDName, c.MainOKVEDCode))
	sb.WriteString(fmt.Sprintf("- Размер: %s, Выручка: %d руб.\n", c.BusinessSizeFNS, c.RevenueCompany))
	sb.WriteString(fmt.Sprintf("- Регион: %s, Город: %s\n", c.Region, c.City))
	if c.FTSCountryName != "" {
		sb.WriteString(fmt.Sprintf("- Внешнеэкономика: %s\n", c.FTSCountryName))
	}
	if len(c.AdditionalSectors) > 0 {
		sb.WriteString(fmt.Sprintf("- Доп. отрасли (через фин. связи): %s\n", strings.Join(c.AdditionalSectors, ", ")))
	}
	sb.WriteString(fmt.Sprintf("- Фин. продукты: "))
	products := []string{}
	if c.CLProductRKOMark { products = append(products, "РКО") }
	if c.CLProductGARMark { products = append(products, "Гарантии") }
	if c.CLProductLOAMark { products = append(products, "Кредиты") }
	if c.CLProductLEAMark { products = append(products, "Лизинг") }
	if c.CLProductDEPMark { products = append(products, "Депозиты") }
	if c.CLProductZPPMark { products = append(products, "Зарплатный проект") }
	if c.FactoringMark { products = append(products, "Факторинг") }
	if len(products) == 0 {
		sb.WriteString("нет данных")
	} else {
		sb.WriteString(strings.Join(products, ", "))
	}
	sb.WriteString("\n")

	if profile.Group != nil {
		g := profile.Group
		sb.WriteString(fmt.Sprintf("\nГРУППА (%s):\n", g.GroupID))
		sb.WriteString(fmt.Sprintf("- Размер группы: %s, Суммарная выручка: %d руб.\n", g.BusinessSizeBank, g.RevenueSum))
		if len(g.OwnSectors) > 0 {
			sb.WriteString(fmt.Sprintf("- Отрасли группы: %s\n", strings.Join(g.OwnSectors, ", ")))
		}
		if len(g.AdditionalSectors) > 0 {
			sb.WriteString(fmt.Sprintf("- Доп. отрасли группы: %s\n", strings.Join(g.AdditionalSectors, ", ")))
		}
		if len(g.Regions) > 0 {
			sb.WriteString(fmt.Sprintf("- Регионы присутствия: %s\n", strings.Join(g.Regions, ", ")))
		}
		if len(g.FTSCountries) > 0 {
			sb.WriteString(fmt.Sprintf("- Страны внешнеэкономики: %s\n", strings.Join(g.FTSCountries, ", ")))
		}
	}

	return sb.String()
}

// MarshalJSONHelper safely marshals interface{} to JSON string
func MarshalJSONHelper(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}