package handlers

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"lumina-imagehost/internal/imaging"
	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/storage"
)

// ChunkedInit initializes a resumable chunked upload session for large files.
func (s *Server) ChunkedInit(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	_, policy, quota, used, err := s.resolveUploadRoleAndQuota(r.Context(), p)
	if err != nil {
		writeErr(w, http.StatusForbidden, err.Error())
		return
	}

	var req struct {
		SHA256      string `json:"sha256"`
		Filename    string `json:"filename"`
		MimeType    string `json:"mime_type"`
		TotalSize   int64  `json:"total_size"`
		ChunkSize   int64  `json:"chunk_size"`
		TotalParts  int    `json:"total_parts"`
		Engine      string `json:"engine"`
		AlbumID     *int64 `json:"album_id"`
		Visibility  string `json:"visibility"`
		CustomAlias string `json:"custom_alias"`
	}
	if err := decodeJSON(r, &req); err != nil || req.TotalSize <= 0 || req.TotalParts <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的分片初始化参数")
		return
	}
	if req.TotalSize > policy.MaxFileSizeBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "文件超出当前角色上限")
		return
	}
	if p != nil && used+req.TotalSize > quota {
		writeErr(w, http.StatusInsufficientStorage, "存储配额不足")
		return
	}
	if req.Visibility == "" {
		req.Visibility = "public"
	}

	reqEngine := req.Engine
	if reqEngine == "" || reqEngine == "auto" {
		reqEngine = policy.DefaultEngine
	}
	drv, err := s.Router.ResolveEngine(reqEngine, policy.AllowedEngines, req.TotalSize)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	id := uuid.New()
	var uidPtr *int64
	if p != nil {
		uid := p.UserID
		uidPtr = &uid
	}
	_, err = s.Pool.Exec(r.Context(), `
		INSERT INTO multipart_uploads (id, user_id, sha256, filename, mime_type, total_size, chunk_size, total_parts, storage_engine, album_id, visibility, custom_alias, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW() + INTERVAL '2 hours')
	`, id, uidPtr, strings.ToLower(req.SHA256), req.Filename, req.MimeType, req.TotalSize, req.ChunkSize, req.TotalParts, drv.Name(), req.AlbumID, req.Visibility, req.CustomAlias)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建分片会话失败")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"upload_id": id.String(), "engine": drv.Name()})
}

// ChunkedPart receives an individual chunk part and records it in PostgreSQL for resumability.
func (s *Server) ChunkedPart(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	partNum, err := strconv.Atoi(chi.URLParam(r, "partNum"))
	if err != nil || partNum < 1 {
		writeErr(w, http.StatusBadRequest, "invalid part number")
		return
	}

	tmpDir := filepath.Join(os.TempDir(), "lumina_chunks", id)
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, "mkdir failed")
		return
	}
	partPath := filepath.Join(tmpDir, fmt.Sprintf("%06d.part", partNum))
	f, err := os.Create(partPath)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create part failed")
		return
	}
	_, copyErr := io.Copy(f, io.LimitReader(r.Body, 32*1024*1024))
	_ = f.Close()
	if copyErr != nil {
		writeErr(w, http.StatusBadRequest, "write part failed")
		return
	}

	_, _ = s.Pool.Exec(r.Context(), `
		UPDATE multipart_uploads
		SET uploaded_parts = array_append(uploaded_parts, $1)
		WHERE id = $2 AND NOT ($1 = ANY(uploaded_parts))
	`, partNum, id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "part": partNum})
}

// ChunkedComplete merges uploaded parts, stores in Local/R2, and commits asset record.
func (s *Server) ChunkedComplete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		ThumbHash string `json:"thumbhash"`
	}
	_ = decodeJSON(r, &req)

	var (
		uidPtr      *int64
		shaHex      string
		filename    string
		mimeType    string
		totalSize   int64
		totalParts  int
		engine      string
		albumID     *int64
		visibility  string
		customAlias string
	)
	err := s.Pool.QueryRow(r.Context(), `
		SELECT user_id, sha256, filename, mime_type, total_size, total_parts, storage_engine, album_id, visibility, custom_alias
		FROM multipart_uploads WHERE id = $1 AND expires_at > NOW()
	`, id).Scan(&uidPtr, &shaHex, &filename, &mimeType, &totalSize, &totalParts, &engine, &albumID, &visibility, &customAlias)
	if err != nil {
		writeErr(w, http.StatusNotFound, "分片会话不存在或已过期")
		return
	}

	tmpDir := filepath.Join(os.TempDir(), "lumina_chunks", id)
	defer os.RemoveAll(tmpDir)

	var buf bytes.Buffer
	for i := 1; i <= totalParts; i++ {
		b, err := os.ReadFile(filepath.Join(tmpDir, fmt.Sprintf("%06d.part", i)))
		if err != nil {
			writeErr(w, http.StatusBadRequest, fmt.Sprintf("缺少第 %d 个分片，请断点续传", i))
			return
		}
		buf.Write(b)
	}

	data := buf.Bytes()
	drv, err := s.Router.GetDriver(engine)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	uname := "guest"
	if p := middleware.PrincipalFromCtx(r.Context()); p != nil && p.Username != "" {
		uname = p.Username
	}
	objectKey := storage.BuildObjectKeyForUser(uname, shaHex, filename, mimeType)
	if err := drv.Put(r.Context(), objectKey, bytes.NewReader(data), int64(len(data)), mimeType); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	meta := imaging.Inspect(bytes.NewReader(data))
	paletteJSON, _ := json.Marshal(meta.ColorPalette)
	exifJSON, _ := json.Marshal(meta.ExifData)
	var objID int64
	err = s.Pool.QueryRow(r.Context(), `
		INSERT INTO storage_objects (sha256, storage_engine, object_key, mime_type, size_bytes, width, height, dominant_color, color_palette, thumbhash, exif_data, moderation_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'passed')
		ON CONFLICT (sha256) DO UPDATE SET updated_at = NOW()
		RETURNING id
	`, shaHex, engine, objectKey, mimeType, int64(len(data)), meta.Width, meta.Height, meta.DominantColor, paletteJSON, req.ThumbHash, exifJSON).Scan(&objID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入对象记录失败")
		return
	}
	_, _ = s.Pool.Exec(r.Context(), `DELETE FROM multipart_uploads WHERE id = $1`, id)

	asset, err := s.createAssetLinkWithAlias(r.Context(), uidPtr, objID, albumID, filename, visibility, "", nil, int64(len(data)), customAlias)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"asset": asset})
}

// BatchDownloadZip streams a ZIP archive of selected assets to the client.
func (s *Server) BatchDownloadZip(w http.ResponseWriter, r *http.Request) {
	p := middleware.PrincipalFromCtx(r.Context())
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := decodeJSON(r, &req); err != nil || len(req.IDs) == 0 {
		writeErr(w, http.StatusBadRequest, "请选择要打包的图片")
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="lumina-gallery-export.zip"`)
	zw := zip.NewWriter(w)
	defer zw.Close()

	usedNames := map[string]int{}
	for _, id := range req.IDs {
		asset, err := s.fetchAssetByID(r.Context(), id)
		if err != nil || asset.UserID == nil || (*asset.UserID != p.UserID && p.Role != "admin") {
			continue
		}
		drv, err := s.Router.GetDriver(asset.StorageEngine)
		if err != nil {
			continue
		}
		rc, _, _, err := drv.Get(r.Context(), asset.ObjectKey)
		if err != nil {
			continue
		}
		name := asset.OriginalName
		if count := usedNames[name]; count > 0 {
			ext := filepath.Ext(name)
			base := strings.TrimSuffix(name, ext)
			name = fmt.Sprintf("%s_%d%s", base, count, ext)
		}
		usedNames[asset.OriginalName]++
		zf, err := zw.Create(name)
		if err == nil {
			_, _ = io.Copy(zf, rc)
		}
		rc.Close()
	}
}
