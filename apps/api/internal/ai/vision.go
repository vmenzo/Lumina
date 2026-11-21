package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"lumina-imagehost/internal/config"
)

type VisionResult struct {
	Caption  string   `json:"caption"`
	Tags     []string `json:"tags"`
	Provider string   `json:"provider"` // "vision-llm" or "local-heuristic"
}

// AnalyzeImage calls an OpenAI-compatible Vision LLM (GPT-4o-mini, Gemini, Qwen-VL, Ollama)
// and gracefully falls back to local color/aspect/EXIF semantic tagging when AI_API_KEY is unset.
func AnalyzeImage(ctx context.Context, cfg *config.Config, imgBytes []byte, mimeType, filename, dominantColor string, width, height int) VisionResult {
	if cfg.AIAPIKey != "" && len(imgBytes) > 0 && len(imgBytes) <= 12*1024*1024 {
		if res, err := callOpenAIVision(ctx, cfg, imgBytes, mimeType); err == nil && (res.Caption != "" || len(res.Tags) > 0) {
			res.Provider = "vision-llm"
			return res
		}
	}
	return fallbackHeuristic(filename, dominantColor, width, height)
}

func callOpenAIVision(ctx context.Context, cfg *config.Config, imgBytes []byte, mimeType string) (VisionResult, error) {
	if mimeType == "" {
		mimeType = "image/jpeg"
	}
	dataURI := fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(imgBytes))

	payload := map[string]any{
		"model": cfg.AIModel,
		"messages": []map[string]any{
			{
				"role": "user",
				"content": []map[string]any{
					{
						"type": "text",
						"text": `请分析这张图片，严格返回纯 JSON（不要包含 Markdown 代码块），格式为：{"caption":"一句简短精准的中文画面描述","tags":["标签1","标签2","标签3","标签4","标签5"]}`,
					},
					{
						"type": "image_url",
						"image_url": map[string]string{
							"url": dataURI,
						},
					},
				},
			},
		},
		"max_tokens": 220,
	}

	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.AIAPIBase+"/chat/completions", bytes.NewReader(b))
	if err != nil {
		return VisionResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.AIAPIKey)

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return VisionResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return VisionResult{}, fmt.Errorf("ai api status %d", resp.StatusCode)
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil || len(parsed.Choices) == 0 {
		return VisionResult{}, fmt.Errorf("invalid ai response")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var vr VisionResult
	if err := json.Unmarshal([]byte(content), &vr); err != nil {
		return VisionResult{Caption: content, Tags: []string{}}, nil
	}
	return vr, nil
}

func fallbackHeuristic(filename, dominantColor string, width, height int) VisionResult {
	tags := []string{}
	orient := "方形构图"
	if width > 0 && height > 0 {
		ratio := float64(width) / float64(height)
		if ratio > 1.25 {
			orient = "横屏宽幅"
			tags = append(tags, "横屏")
		} else if ratio < 0.8 {
			orient = "竖屏人像/海报"
			tags = append(tags, "竖屏")
		} else {
			tags = append(tags, "方图")
		}
		if width >= 3000 || height >= 2000 {
			tags = append(tags, "超清4K")
		} else if width >= 1920 {
			tags = append(tags, "高清")
		}
	}

	colorLabel := classifyColor(dominantColor)
	if colorLabel != "" {
		tags = append(tags, colorLabel)
	}
	lower := strings.ToLower(filename)
	if strings.Contains(lower, "screen") || strings.Contains(lower, "shot") || strings.Contains(lower, "截图") {
		tags = append(tags, "截图")
	} else if strings.Contains(lower, "avatar") || strings.Contains(lower, "头像") {
		tags = append(tags, "头像")
	} else if strings.Contains(lower, "wall") || strings.Contains(lower, "壁纸") {
		tags = append(tags, "壁纸")
	}

	caption := fmt.Sprintf("%s图片（主色调：%s，%d×%d）", orient, colorLabel, width, height)
	return VisionResult{
		Caption:  caption,
		Tags:     tags,
		Provider: "local-heuristic",
	}
}

func classifyColor(hex string) string {
	hex = strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(hex) != 6 {
		return "中性色"
	}
	r, _ := strconv.ParseInt(hex[0:2], 16, 64)
	g, _ := strconv.ParseInt(hex[2:4], 16, 64)
	b, _ := strconv.ParseInt(hex[4:6], 16, 64)
	maxV := max64(r, max64(g, b))
	minV := min64(r, min64(g, b))
	if maxV-minV < 28 {
		if maxV < 70 {
			return "暗黑极简"
		}
		if minV > 185 {
			return "纯净浅白"
		}
		return "黑白灰"
	}
	if r > g+25 && r > b+25 {
		return "暖红橙"
	}
	if r > 150 && g > 110 && b < 110 {
		return "琥珀金"
	}
	if g > r+15 && g > b+15 {
		return "森系绿"
	}
	if b > r+20 && b >= g {
		return "深海蓝"
	}
	if r > 100 && b > 120 && g < r {
		return "霓虹紫"
	}
	return "自然色调"
}

func ColorDistanceHex(h1, h2 string) float64 {
	r1, g1, b1 := parseHexRGB(h1)
	r2, g2, b2 := parseHexRGB(h2)
	dr := float64(r1 - r2)
	dg := float64(g1 - g2)
	db := float64(b1 - b2)
	return dr*dr + dg*dg + db*db
}

func parseHexRGB(hex string) (int64, int64, int64) {
	hex = strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(hex) != 6 {
		return 128, 128, 128
	}
	r, _ := strconv.ParseInt(hex[0:2], 16, 64)
	g, _ := strconv.ParseInt(hex[2:4], 16, 64)
	b, _ := strconv.ParseInt(hex[4:6], 16, 64)
	return r, g, b
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
