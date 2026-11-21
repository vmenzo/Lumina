package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"lumina-imagehost/internal/db"
	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
)

func (s *Server) AdminDashboard(w http.ResponseWriter, r *http.Request) {
	var totalUsers, totalAssets, totalObjects, pendingMod, totalViews int64
	var localBytes, r2Bytes, logicalBytes int64

	_ = s.Pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM users`).Scan(&totalUsers)
	_ = s.Pool.QueryRow(r.Context(), `SELECT COUNT(*), COALESCE(SUM(view_count),0) FROM user_assets WHERE deleted_at IS NULL`).Scan(&totalAssets, &totalViews)
	_ = s.Pool.QueryRow(r.Context(), `
		SELECT COUNT(*),
		       COALESCE(SUM(size_bytes) FILTER (WHERE storage_engine = 'local'), 0),
		       COALESCE(SUM(size_bytes) FILTER (WHERE storage_engine = 'r2'), 0),
		       COALESCE(SUM(size_bytes * GREATEST(ref_count, 1)), 0),
		       COUNT(*) FILTER (WHERE moderation_status = 'pending')
		FROM storage_objects
	`).Scan(&totalObjects, &localBytes, &r2Bytes, &logicalBytes, &pendingMod)

	physicalBytes := localBytes + r2Bytes
	savedBytes := logicalBytes - physicalBytes
	if savedBytes < 0 {
		savedBytes = 0
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"stats": map[string]any{
			"total_users":    totalUsers,
			"total_assets":   totalAssets,
			"total_objects":  totalObjects,
			"pending_mod":    pendingMod,
			"total_views":    totalViews,
			"local_bytes":    localBytes,
			"r2_bytes":       r2Bytes,
			"physical_bytes": physicalBytes,
			"saved_bytes":    savedBytes,
		},
		"storage": s.Router.Status(r.Context()),
		"queue":   s.Worker.QueueStats(),
	})
}

func (s *Server) AdminListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT u.id, u.username, u.email, u.role, u.storage_quota_override, rp.storage_quota_bytes,
		       u.storage_used_bytes, u.status, u.totp_enabled, u.last_login_at, u.created_at
		FROM users u
		JOIN role_policies rp ON rp.role = u.role
		ORDER BY u.created_at DESC LIMIT 200
	`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query users failed")
		return
	}
	defer rows.Close()
	users := []models.User{}
	for rows.Next() {
		var u models.User
		var override *int64
		var policyQuota int64
		if rows.Scan(&u.ID, &u.Username, &u.Email, &u.Role, &override, &policyQuota, &u.StorageUsedBytes, &u.Status, &u.TOTPEnabled, &u.LastLoginAt, &u.CreatedAt) == nil {
			if override != nil {
				u.StorageQuotaBytes = *override
			} else {
				u.StorageQuotaBytes = policyQuota
			}
			users = append(users, u)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (s *Server) AdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req struct {
		Role                 string `json:"role"`
		Status               string `json:"status"`
		StorageQuotaOverride *int64 `json:"storage_quota_override"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	_, err := s.Pool.Exec(r.Context(), `
		UPDATE users SET role = COALESCE(NULLIF($1,''), role),
		                 status = COALESCE(NULLIF($2,''), status),
		                 storage_quota_override = $3,
		                 updated_at = NOW()
		WHERE id = $4
	`, req.Role, req.Status, req.StorageQuotaOverride, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "update user failed")
		return
	}
	db.WriteAudit(r.Context(), s.Pool, &p.UserID, p.Username, "admin.user.update", "user", fmt.Sprint(id), req, middleware.ClientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) AdminListPolicies(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT role, display_name, storage_quota_bytes, max_file_size_bytes, allowed_mimes,
		       rate_limit_per_min, COALESCE(monthly_upload_limit, 0), allowed_engines, default_engine, require_moderation,
		       allow_api_token, allow_custom_watermark, updated_at
		FROM role_policies ORDER BY storage_quota_bytes ASC
	`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query policies failed")
		return
	}
	defer rows.Close()
	list := []models.RolePolicy{}
	for rows.Next() {
		var rp models.RolePolicy
		if rows.Scan(&rp.Role, &rp.DisplayName, &rp.StorageQuotaBytes, &rp.MaxFileSizeBytes, &rp.AllowedMimes,
			&rp.RateLimitPerMin, &rp.MonthlyUploadLimit, &rp.AllowedEngines, &rp.DefaultEngine, &rp.RequireModeration,
			&rp.AllowAPIToken, &rp.AllowCustomWatermark, &rp.UpdatedAt) == nil {
			list = append(list, rp)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"policies": list})
}

func (s *Server) AdminUpdatePolicy(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	role := chi.URLParam(r, "role")
	var req models.RolePolicy
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	_, err := s.Pool.Exec(r.Context(), `
		UPDATE role_policies
		SET display_name = $1, storage_quota_bytes = $2, max_file_size_bytes = $3,
		    allowed_mimes = $4, rate_limit_per_min = $5, monthly_upload_limit = $12, allowed_engines = $6,
		    default_engine = $7, require_moderation = $8, allow_api_token = $9,
		    allow_custom_watermark = $10, updated_at = NOW()
		WHERE role = $11
	`, req.DisplayName, req.StorageQuotaBytes, req.MaxFileSizeBytes, req.AllowedMimes,
		req.RateLimitPerMin, req.AllowedEngines, req.DefaultEngine, req.RequireModeration,
		req.AllowAPIToken, req.AllowCustomWatermark, role, req.MonthlyUploadLimit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "更新角色策略失败: "+err.Error())
		return
	}
	db.WriteAudit(r.Context(), s.Pool, &p.UserID, p.Username, "admin.policy.update", "role_policy", role, req, middleware.ClientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) AdminModerationQueue(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "pending"
	}
	rows, err := s.Pool.Query(r.Context(), assetSelectSQL+`
		WHERE so.moderation_status = $1
		ORDER BY ua.created_at DESC LIMIT 100
	`, status)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query moderation queue failed")
		return
	}
	defer rows.Close()
	items := []*models.AssetView{}
	for rows.Next() {
		if a, err := scanAsset(rows); err == nil {
			s.populateAssetURLs(a)
			items = append(items, a)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// AdminModerationAction approves or blocks an object; blocking bans the SHA-256 globally, deletes the physical blob, and enqueues Cloudflare CDN purge via Asynq.
func (s *Server) AdminModerationAction(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	objID, _ := strconv.ParseInt(chi.URLParam(r, "objectId"), 10, 64)
	var req struct {
		Action string `json:"action"` // pass, block
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	var engine, key, shaHex string
	if err := s.Pool.QueryRow(r.Context(), `SELECT storage_engine, object_key, sha256 FROM storage_objects WHERE id = $1`, objID).Scan(&engine, &key, &shaHex); err != nil {
		writeErr(w, http.StatusNotFound, "object not found")
		return
	}

	if req.Action == "pass" {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE storage_objects SET moderation_status = 'passed', moderation_reason = '', updated_at = NOW() WHERE id = $1`, objID)
	} else {
		_, _ = s.Pool.Exec(r.Context(), `UPDATE storage_objects SET moderation_status = 'blocked', moderation_reason = $1, updated_at = NOW() WHERE id = $2`, req.Reason, objID)
		if drv, err := s.Router.GetDriver(engine); err == nil {
			_ = drv.Delete(r.Context(), key)
		}
		purgeURLs := []string{}
		if engine == "r2" && s.Cfg.R2PublicURL != "" {
			purgeURLs = append(purgeURLs, fmt.Sprintf("%s/%s", s.Cfg.R2PublicURL, key))
		}
		rows, err := s.Pool.Query(r.Context(), `SELECT short_code FROM user_assets WHERE object_id = $1`, objID)
		if err == nil {
			for rows.Next() {
				var sc string
				if rows.Scan(&sc) == nil {
					purgeURLs = append(purgeURLs, fmt.Sprintf("%s/raw/%s", s.Cfg.CDNPublicURL, sc))
				}
			}
			rows.Close()
		}
		s.Worker.EnqueueCDNPurge(purgeURLs)
	}

	db.WriteAudit(r.Context(), s.Pool, &p.UserID, p.Username, "admin.moderation."+req.Action, "storage_object", fmt.Sprint(objID),
		map[string]any{"sha256": shaHex, "reason": req.Reason}, middleware.ClientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) AdminListInvites(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, code, role, max_uses, used_count, expires_at, created_at
		FROM invite_codes ORDER BY created_at DESC LIMIT 100
	`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query invites failed")
		return
	}
	defer rows.Close()
	list := []models.InviteCode{}
	for rows.Next() {
		var c models.InviteCode
		if rows.Scan(&c.ID, &c.Code, &c.Role, &c.MaxUses, &c.UsedCount, &c.ExpiresAt, &c.CreatedAt) == nil {
			list = append(list, c)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": list})
}

func (s *Server) AdminCreateInvites(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req struct {
		Count      int    `json:"count"`
		Role       string `json:"role"`
		MaxUses    int    `json:"max_uses"`
		ExpireDays int    `json:"expire_days"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Count <= 0 || req.Count > 50 {
		req.Count = 5
	}
	if req.MaxUses <= 0 {
		req.MaxUses = 1
	}
	if req.Role == "" {
		req.Role = "user"
	}
	var exp *time.Time
	if req.ExpireDays > 0 {
		t := time.Now().Add(time.Duration(req.ExpireDays) * 24 * time.Hour)
		exp = &t
	}
	created := []string{}
	for i := 0; i < req.Count; i++ {
		code := "LUM-" + strings.ToUpper(randomCode(8))
		if _, err := s.Pool.Exec(r.Context(), `
			INSERT INTO invite_codes (code, role, max_uses, created_by, expires_at)
			VALUES ($1,$2,$3,$4,$5)
		`, code, req.Role, req.MaxUses, p.UserID, exp); err == nil {
			created = append(created, code)
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"codes": created})
}

func (s *Server) AdminGetSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"general":  s.getSiteSetting(r.Context(), "general"),
		"security": s.getSiteSetting(r.Context(), "security"),
		"storage":  s.Router.Status(r.Context()),
	})
}

func (s *Server) AdminSaveSetting(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	key := chi.URLParam(r, "key")
	if key != "general" && key != "security" && key != "storage" {
		writeErr(w, http.StatusBadRequest, "unknown settings group")
		return
	}
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	raw, _ := json.Marshal(body)
	if err := s.Queries.UpsertSiteSetting(r.Context(), key, raw); err != nil {
		writeErr(w, http.StatusInternalServerError, "save setting failed")
		return
	}
	db.WriteAudit(r.Context(), s.Pool, &p.UserID, p.Username, "admin.settings.update", "site_settings", key, body, middleware.ClientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) AdminAuditLogs(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, user_id, username, action, target_type, target_id, detail, ip_address, created_at
		FROM audit_logs ORDER BY created_at DESC LIMIT 100
	`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query logs failed")
		return
	}
	defer rows.Close()
	logs := []models.AuditLog{}
	for rows.Next() {
		var l models.AuditLog
		if rows.Scan(&l.ID, &l.UserID, &l.Username, &l.Action, &l.TargetType, &l.TargetID, &l.Detail, &l.IPAddress, &l.CreatedAt) == nil {
			logs = append(logs, l)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

func (s *Server) AdminRunGC(w http.ResponseWriter, r *http.Request) {
	res := s.Worker.RunOnce(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"gc_result": res})
}
