package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"backend/internal/config"
	"backend/internal/model_a"
	"backend/internal/model_b"
	"backend/internal/news_digest"
	"backend/internal/prompt"
	"backend/internal/user_profile"
)

// Dependencies holds all service dependencies
type Dependencies struct {
	Config       *config.Config
	ModelA       *model_a.Client
	ModelB       *model_b.Client
	UserProfile  *user_profile.Repository
	NewsDigest   *news_digest.Repository
	PromptBuilder *prompt.Builder
}

// NewRouter creates and configures the HTTP router
func NewRouter(deps *Dependencies) http.Handler {
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * 1e9)) // 60 seconds

	// Health check
	r.Get("/health", healthHandler)

	// API routes
	r.Route("/api", func(r chi.Router) {
		r.Post("/news", deps.ingestNews)
		r.Get("/push", deps.pushHandler)
		r.Post("/chat", deps.chatHandler)
	})

	return r
}

// healthHandler returns simple health check
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// ingestNews handles POST /api/news from daemon
func (deps *Dependencies) ingestNews(w http.ResponseWriter, r *http.Request) {
	var req model_a.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.RawText == "" || req.SourceName == "" {
		http.Error(w, "raw_text and source_name are required", http.StatusBadRequest)
		return
	}

	// Call Model A
	resp, err := deps.ModelA.ProcessNews(r.Context(), req)
	if err != nil {
		http.Error(w, "model A error: "+err.Error(), http.StatusBadGateway)
		return
	}

	// Convert to Digest and save
	digest := &news_digest.Digest{
		IndustryIDList: resp.IndustryIDList,
		Region:         resp.Region,
		City:           resp.City,
		Country:        resp.Country,
		Source:         resp.Source,
		Text:           resp.Text,
	}

	id, err := deps.NewsDigest.Create(r.Context(), digest)
	if err != nil {
		http.Error(w, "save digest error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]int64{"id": id})
}

// pushHandler handles GET /api/push?user_id=...
func (deps *Dependencies) pushHandler(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}

	// Get user profile
	profile, err := deps.UserProfile.GetFullProfile(r.Context(), userID)
	if err != nil {
		http.Error(w, "user profile error: "+err.Error(), http.StatusNotFound)
		return
	}

	// Get latest digests
	digests, err := deps.NewsDigest.GetLatest(r.Context(), deps.PromptBuilder.MaxDigests())
	if err != nil {
		http.Error(w, "news digest error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Build prompt
	pushReq, err := deps.PromptBuilder.BuildPushPrompt(profile, digests)
	if err != nil {
		http.Error(w, "prompt build error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Call Model B
	pushResp, err := deps.ModelB.Push(r.Context(), pushReq)
	if err != nil {
		http.Error(w, "model B error: "+err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pushResp)
}

// chatHandler handles POST /api/chat
func (deps *Dependencies) chatHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID string `json:"user_id"`
		Query  string `json:"query,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.UserID == "" {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}

	// Get user profile
	profile, err := deps.UserProfile.GetFullProfile(r.Context(), req.UserID)
	if err != nil {
		http.Error(w, "user profile error: "+err.Error(), http.StatusNotFound)
		return
	}

	// Get latest digests
	digests, err := deps.NewsDigest.GetLatest(r.Context(), deps.PromptBuilder.MaxDigests())
	if err != nil {
		http.Error(w, "news digest error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Build prompt
	chatReq, err := deps.PromptBuilder.BuildChatPrompt(profile, digests, req.Query)
	if err != nil {
		http.Error(w, "prompt build error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Call Model B
	chatResp, err := deps.ModelB.Chat(r.Context(), chatReq)
	if err != nil {
		http.Error(w, "model B error: "+err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(chatResp)
}