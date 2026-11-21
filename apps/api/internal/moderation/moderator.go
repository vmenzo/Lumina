package moderation

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"
)

type Verdict struct {
	Passed bool   `json:"passed"`
	Label  string `json:"label"`
	Reason string `json:"reason"`
}

// Moderator defines a pluggable content moderation interface (Webhook / Local NSFW model / 3rd-party API).
type Moderator interface {
	CheckImage(ctx context.Context, imageURL, sha256Hex string) (Verdict, error)
}

type WebhookModerator struct {
	Endpoint string
	Secret   string
	Client   *http.Client
}

func NewWebhookModerator(endpoint, secret string) Moderator {
	if endpoint == "" {
		return &NoopModerator{}
	}
	return &WebhookModerator{
		Endpoint: endpoint,
		Secret:   secret,
		Client:   &http.Client{Timeout: 15 * time.Second},
	}
}

func (m *WebhookModerator) CheckImage(ctx context.Context, imageURL, sha256Hex string) (Verdict, error) {
	body, _ := json.Marshal(map[string]string{
		"image_url": imageURL,
		"sha256":    sha256Hex,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.Endpoint, bytes.NewReader(body))
	if err != nil {
		return Verdict{Passed: true}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if m.Secret != "" {
		mac := hmac.New(sha256.New, []byte(m.Secret))
		mac.Write(body)
		req.Header.Set("X-Lumina-Signature", hex.EncodeToString(mac.Sum(nil)))
	}
	resp, err := m.Client.Do(req)
	if err != nil {
		return Verdict{Passed: true}, err
	}
	defer resp.Body.Close()

	var v Verdict
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return Verdict{Passed: true}, nil
	}
	return v, nil
}

type NoopModerator struct{}

func (n *NoopModerator) CheckImage(_ context.Context, _, _ string) (Verdict, error) {
	return Verdict{Passed: true, Label: "clean"}, nil
}
