package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"lumina-imagehost/internal/config"
)

type LocalDriver struct {
	root       string
	signSecret []byte
	publicURL  string
}

type LocalUploadToken struct {
	Key         string `json:"k"`
	ContentType string `json:"ct"`
	MaxSize     int64  `json:"ms"`
	Exp         int64  `json:"exp"`
}

func NewLocalDriver(cfg *config.Config) (*LocalDriver, error) {
	root, err := filepath.Abs(cfg.LocalStoragePath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &LocalDriver{
		root:       root,
		signSecret: []byte(cfg.LocalSignSecret),
		publicURL:  cfg.AppPublicURL,
	}, nil
}

func (d *LocalDriver) Name() string { return "local" }

func (d *LocalDriver) safePath(key string) (string, error) {
	cleaned := filepath.Clean(strings.TrimPrefix(key, "/"))
	if strings.HasPrefix(cleaned, "..") {
		return "", errors.New("invalid object key traversal")
	}
	full := filepath.Join(d.root, cleaned)
	if !strings.HasPrefix(full, d.root) {
		return "", errors.New("path escapes storage root")
	}
	return full, nil
}

func (d *LocalDriver) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	full, err := d.safePath(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	tmp := full + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, full)
}

func (d *LocalDriver) Get(_ context.Context, key string) (io.ReadCloser, int64, string, error) {
	full, err := d.safePath(key)
	if err != nil {
		return nil, 0, "", err
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, 0, "", err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, 0, "", err
	}
	ct := mime.TypeByExtension(filepath.Ext(full))
	if ct == "" {
		ct = "application/octet-stream"
	}
	return f, st.Size(), ct, nil
}

func (d *LocalDriver) Delete(_ context.Context, key string) error {
	full, err := d.safePath(key)
	if err != nil {
		return err
	}
	err = os.Remove(full)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (d *LocalDriver) Exists(_ context.Context, key string) (bool, int64, error) {
	full, err := d.safePath(key)
	if err != nil {
		return false, 0, err
	}
	st, err := os.Stat(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, 0, nil
		}
		return false, 0, err
	}
	return true, st.Size(), nil
}

func (d *LocalDriver) PresignPut(_ context.Context, key string, contentType string, size int64, ttl time.Duration) (*PresignedUpload, error) {
	tok := LocalUploadToken{
		Key:         key,
		ContentType: contentType,
		MaxSize:     size,
		Exp:         time.Now().Add(ttl).Unix(),
	}
	payload, _ := json.Marshal(tok)
	b64 := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, d.signSecret)
	mac.Write([]byte(b64))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	signed := b64 + "." + sig

	return &PresignedUpload{
		URL:    fmt.Sprintf("%s/api/v1/upload/local/%s", d.publicURL, signed),
		Method: "PUT",
		Headers: map[string]string{
			"Content-Type": contentType,
		},
		Engine: "local",
	}, nil
}

func (d *LocalDriver) VerifyToken(signed string) (*LocalUploadToken, error) {
	parts := strings.Split(signed, ".")
	if len(parts) != 2 {
		return nil, errors.New("malformed upload token")
	}
	mac := hmac.New(sha256.New, d.signSecret)
	mac.Write([]byte(parts[0]))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return nil, errors.New("invalid upload signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	var tok LocalUploadToken
	if err := json.Unmarshal(raw, &tok); err != nil {
		return nil, err
	}
	if time.Now().Unix() > tok.Exp {
		return nil, errors.New("upload token expired")
	}
	return &tok, nil
}

func (d *LocalDriver) PublicURL(key string) string {
	return fmt.Sprintf("%s/raw/key/%s", d.publicURL, key)
}

func (d *LocalDriver) HealthCheck(_ context.Context) error {
	probe := filepath.Join(d.root, ".lumina_health")
	if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
		return err
	}
	return os.Remove(probe)
}
