package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"lumina-imagehost/internal/middleware"
)

type davMultistatus struct {
	XMLName   xml.Name      `xml:"D:multistatus"`
	Xmlns     string        `xml:"xmlns:D,attr"`
	Responses []davResponse `xml:"D:response"`
}

type davResponse struct {
	Href     string      `xml:"D:href"`
	Propstat davPropstat `xml:"D:propstat"`
}

type davPropstat struct {
	Prop   davProp `xml:"D:prop"`
	Status string  `xml:"D:status"`
}

type davProp struct {
	DisplayName   string           `xml:"D:displayname,omitempty"`
	ResourceType  *davResourceType `xml:"D:resourcetype"`
	ContentLength int64            `xml:"D:getcontentlength,omitempty"`
	ContentType   string           `xml:"D:getcontenttype,omitempty"`
	LastModified  string           `xml:"D:getlastmodified,omitempty"`
}

type davResourceType struct {
	Collection *struct{} `xml:"D:collection,omitempty"`
}

// authenticateWebDAV validates HTTP Basic Auth using username + (account password OR API token lum_...).
func (s *Server) authenticateWebDAV(r *http.Request) *middleware.AuthPrincipal {
	user, pass, ok := r.BasicAuth()
	if !ok || user == "" || pass == "" {
		return nil
	}
	// 1. Support API Token as Basic Auth password
	if strings.HasPrefix(pass, "lum_") {
		sum := sha256.Sum256([]byte(pass))
		hashHex := hex.EncodeToString(sum[:])
		var p middleware.AuthPrincipal
		var status string
		err := s.Pool.QueryRow(r.Context(), `
			SELECT t.user_id, u.username, u.role, u.status, t.scopes
			FROM api_tokens t JOIN users u ON u.id = t.user_id
			WHERE t.token_hash = $1 AND (t.expires_at IS NULL OR t.expires_at > NOW())
		`, hashHex).Scan(&p.UserID, &p.Username, &p.Role, &status, &p.Scopes)
		if err == nil && status == "active" {
			p.IsToken = true
			return &p
		}
	}
	// 2. Support username/email + password
	var uid int64
	var uname, role, passHash, status string
	err := s.Pool.QueryRow(r.Context(), `
		SELECT id, username, role, password_hash, status
		FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)
	`, user).Scan(&uid, &uname, &role, &passHash, &status)
	if err != nil || status != "active" {
		return nil
	}
	if bcrypt.CompareHashAndPassword([]byte(passHash), []byte(pass)) != nil {
		return nil
	}
	return &middleware.AuthPrincipal{UserID: uid, Username: uname, Role: role}
}

// ServeWebDAV exposes the user's Lumina gallery as a mountable WebDAV drive at /webdav/*.
func (s *Server) ServeWebDAV(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.Header().Set("DAV", "1")
		w.Header().Set("Allow", "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE")
		w.WriteHeader(http.StatusOK)
		return
	}

	p := s.authenticateWebDAV(r)
	if p == nil {
		w.Header().Set("WWW-Authenticate", `Basic realm="Lumina WebDAV"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	subPath := strings.TrimPrefix(r.URL.Path, "/webdav")
	subPath = strings.Trim(subPath, "/")

	switch r.Method {
	case "PROPFIND":
		s.webdavPropfind(w, r, p, subPath)
	case http.MethodGet, http.MethodHead:
		s.webdavGet(w, r, p, subPath)
	case http.MethodPut:
		s.webdavPut(w, r, p, subPath)
	case http.MethodDelete:
		s.webdavDelete(w, r, p, subPath)
	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) webdavPropfind(w http.ResponseWriter, r *http.Request, p *middleware.AuthPrincipal, subPath string) {
	depth := r.Header.Get("Depth")
	if depth == "" {
		depth = "1"
	}

	ms := davMultistatus{Xmlns: "DAV:"}
	if subPath != "" {
		code := extractWebDAVCode(subPath)
		var name, mime string
		var sz int64
		var created time.Time
		err := s.Pool.QueryRow(r.Context(), `
			SELECT ua.original_name, so.size_bytes, so.mime_type, ua.created_at
			FROM user_assets ua JOIN storage_objects so ON so.id = ua.object_id
			WHERE ua.short_code = $1 AND ua.user_id = $2 AND ua.deleted_at IS NULL
		`, code, p.UserID).Scan(&name, &sz, &mime, &created)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		ms.Responses = append(ms.Responses, davResponse{
			Href: "/webdav/" + url.PathEscape(path.Base(subPath)),
			Propstat: davPropstat{
				Prop: davProp{
					DisplayName:   path.Base(subPath),
					ResourceType:  &davResourceType{},
					ContentLength: sz,
					ContentType:   mime,
					LastModified:  created.UTC().Format(http.TimeFormat),
				},
				Status: "HTTP/1.1 200 OK",
			},
		})
	} else {
		ms.Responses = append(ms.Responses, davResponse{
			Href: "/webdav/",
			Propstat: davPropstat{
				Prop: davProp{
					DisplayName:  "webdav",
					ResourceType: &davResourceType{Collection: &struct{}{}},
				},
				Status: "HTTP/1.1 200 OK",
			},
		})
	}

	if depth != "0" && subPath == "" {
		// List user's assets in WebDAV root as "<short_code>_<original_name>"
		rows, err := s.Pool.Query(r.Context(), `
			SELECT ua.short_code, ua.original_name, so.size_bytes, so.mime_type, ua.created_at
			FROM user_assets ua
			JOIN storage_objects so ON so.id = ua.object_id
			WHERE ua.user_id = $1 AND ua.deleted_at IS NULL
			ORDER BY ua.created_at DESC LIMIT 300
		`, p.UserID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var code, name, mime string
				var sz int64
				var created time.Time
				if rows.Scan(&code, &name, &sz, &mime, &created) == nil {
					entryName := fmt.Sprintf("%s_%s", code, strings.ReplaceAll(name, "/", "_"))
					ms.Responses = append(ms.Responses, davResponse{
						Href: "/webdav/" + url.PathEscape(entryName),
						Propstat: davPropstat{
							Prop: davProp{
								DisplayName:   entryName,
								ResourceType:  &davResourceType{},
								ContentLength: sz,
								ContentType:   mime,
								LastModified:  created.UTC().Format(http.TimeFormat),
							},
							Status: "HTTP/1.1 200 OK",
						},
					})
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)
	_, _ = w.Write([]byte(xml.Header))
	_ = xml.NewEncoder(w).Encode(ms)
}

func extractWebDAVCode(subPath string) string {
	base := path.Base(subPath)
	if idx := strings.IndexByte(base, '_'); idx > 0 {
		return base[:idx]
	}
	if dot := strings.IndexByte(base, '.'); dot > 0 {
		return base[:dot]
	}
	return base
}

func (s *Server) webdavGet(w http.ResponseWriter, r *http.Request, p *middleware.AuthPrincipal, subPath string) {
	if subPath == "" {
		w.WriteHeader(http.StatusOK)
		return
	}
	code := extractWebDAVCode(subPath)
	var engine, key, mime string
	err := s.Pool.QueryRow(r.Context(), `
		SELECT so.storage_engine, so.object_key, so.mime_type
		FROM user_assets ua
		JOIN storage_objects so ON so.id = ua.object_id
		WHERE ua.short_code = $1 AND ua.user_id = $2 AND ua.deleted_at IS NULL
	`, code, p.UserID).Scan(&engine, &key, &mime)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	drv, err := s.Router.GetDriver(engine)
	if err != nil {
		http.Error(w, "storage unavailable", http.StatusServiceUnavailable)
		return
	}
	rc, sz, ct, err := drv.Get(r.Context(), key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer rc.Close()
	if mime != "" {
		ct = mime
	}
	w.Header().Set("Content-Type", ct)
	if sz > 0 {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", sz))
	}
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	_, _ = io.Copy(w, rc)
}

func (s *Server) webdavPut(w http.ResponseWriter, r *http.Request, p *middleware.AuthPrincipal, subPath string) {
	_, policy, quota, used, err := s.resolveUploadRoleAndQuota(r.Context(), p)
	if err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, policy.MaxFileSizeBytes+1))
	if err != nil || int64(len(data)) == 0 || int64(len(data)) > policy.MaxFileSizeBytes {
		http.Error(w, "invalid file size", http.StatusRequestEntityTooLarge)
		return
	}
	if used+int64(len(data)) > quota {
		http.Error(w, "quota exceeded", http.StatusInsufficientStorage)
		return
	}
	filename := path.Base(subPath)
	if filename == "" || filename == "." {
		filename = "webdav_" + randomCode(6) + ".jpg"
	}
	mimeType := detectImageMime(data, filename)
	if !containsStr(policy.AllowedMimes, mimeType) {
		http.Error(w, "unsupported media type", http.StatusUnsupportedMediaType)
		return
	}
	if _, _, err := s.storeRawBytes(r.Context(), p, policy, data, filename, mimeType, "smart", nil, "public", "", nil); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (s *Server) webdavDelete(w http.ResponseWriter, r *http.Request, p *middleware.AuthPrincipal, subPath string) {
	code := extractWebDAVCode(subPath)
	_, _ = s.Pool.Exec(r.Context(), `UPDATE user_assets SET deleted_at = NOW() WHERE short_code = $1 AND user_id = $2`, code, p.UserID)
	w.WriteHeader(http.StatusNoContent)
}
