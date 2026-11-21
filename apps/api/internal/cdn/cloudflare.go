package cdn

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"lumina-imagehost/internal/config"
)

type Purger struct {
	zoneID   string
	apiToken string
	client   *http.Client
}

func NewPurger(cfg *config.Config) *Purger {
	return &Purger{
		zoneID:   cfg.CFZoneID,
		apiToken: cfg.CFAPIToken,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

func (p *Purger) Enabled() bool {
	return p.zoneID != "" && p.apiToken != ""
}

// PurgeURLs immediately evicts banned/deleted image URLs from Cloudflare CDN edge nodes.
func (p *Purger) PurgeURLs(ctx context.Context, urls []string) error {
	if !p.Enabled() || len(urls) == 0 {
		return nil
	}
	body, _ := json.Marshal(map[string]any{"files": urls})
	endpoint := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/purge_cache", p.zoneID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("cloudflare purge returned status %d", resp.StatusCode)
	}
	return nil
}
