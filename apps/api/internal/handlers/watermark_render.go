package handlers

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"

	"lumina-imagehost/internal/middleware"
	"lumina-imagehost/internal/models"
)

// ServeWatermarkedImage renders a real server-side watermarked image (both text & image logo modes)
// at GET /raw/{code}/watermark (optional ?preset_id=123).
func (s *Server) ServeWatermarkedImage(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if dot := strings.IndexByte(code, '.'); dot > 0 {
		code = code[:dot]
	}

	var (
		ownerID    *int64
		engine     string
		key        string
		mimeType   string
		shaHex     string
		modStatus  string
		visibility string
		expiresAt  *time.Time
	)
	err := s.Pool.QueryRow(r.Context(), `
		SELECT ua.user_id, so.storage_engine, so.object_key, so.mime_type, so.sha256,
		       so.moderation_status, ua.visibility, ua.expires_at
		FROM user_assets ua
		JOIN storage_objects so ON so.id = ua.object_id
		WHERE ua.short_code = $1 AND ua.deleted_at IS NULL
	`, code).Scan(&ownerID, &engine, &key, &mimeType, &shaHex, &modStatus, &visibility, &expiresAt)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if modStatus == "blocked" {
		http.Error(w, "Image blocked", http.StatusUnavailableForLegalReasons)
		return
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		http.Error(w, "Image expired", http.StatusGone)
		return
	}
	if visibility == "private" || visibility == "password" {
		allowed := s.verifyRawSignature(code, r.URL.Query().Get("exp"), r.URL.Query().Get("sig"))
		if !allowed {
			if p := middleware.PrincipalFromCtx(r.Context()); p != nil {
				if p.Role == "admin" || (ownerID != nil && *ownerID == p.UserID) {
					allowed = true
				}
			}
		}
		if !allowed {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
	}

	// Resolve watermark preset: explicit ?preset_id -> owner's default preset -> fallback text preset
	var wp *models.WatermarkPreset
	if pidStr := strings.TrimSpace(r.URL.Query().Get("preset_id")); pidStr != "" {
		if pid, err := strconv.ParseInt(pidStr, 10, 64); err == nil {
			var tmp models.WatermarkPreset
			if s.Pool.QueryRow(r.Context(), `
				SELECT id, user_id, name, mode, text_content, COALESCE(image_url,''), font_size, text_color,
				       opacity, position, offset_x, offset_y, scale, angle, tiled, is_default, created_at
				FROM watermark_presets WHERE id = $1
			`, pid).Scan(
				&tmp.ID, &tmp.UserID, &tmp.Name, &tmp.Mode, &tmp.TextContent, &tmp.ImageURL, &tmp.FontSize, &tmp.TextColor,
				&tmp.Opacity, &tmp.Position, &tmp.OffsetX, &tmp.OffsetY, &tmp.Scale, &tmp.Angle, &tmp.Tiled, &tmp.IsDefault, &tmp.CreatedAt,
			) == nil {
				wp = &tmp
			}
		}
	}
	if wp == nil {
		wp = s.getUserDefaultWatermark(r.Context(), ownerID)
	}
	if wp == nil {
		wp = &models.WatermarkPreset{
			Mode:        "text",
			TextContent: "Lumina Gallery",
			FontSize:    24,
			TextColor:   "#FFFFFF",
			Opacity:     0.55,
			Position:    "soea",
			Scale:       0.25,
		}
	}

	drv, err := s.Router.GetDriver(engine)
	if err != nil {
		http.Error(w, "Storage unavailable", http.StatusServiceUnavailable)
		return
	}
	rc, _, _, err := drv.Get(r.Context(), key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	rawBytes, err := io.ReadAll(io.LimitReader(rc, 48*1024*1024))
	rc.Close()
	if err != nil {
		http.Error(w, "Read source failed", http.StatusInternalServerError)
		return
	}

	srcImg, format, err := image.Decode(bytes.NewReader(rawBytes))
	if err != nil {
		// Non-raster format (e.g. SVG) -> pass through original
		w.Header().Set("Content-Type", mimeType)
		_, _ = w.Write(rawBytes)
		return
	}

	bounds := srcImg.Bounds()
	canvas := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(canvas, canvas.Bounds(), srcImg, bounds.Min, draw.Src)

	if wp.Mode == "image" && strings.TrimSpace(wp.ImageURL) != "" {
		if logoImg, err := fetchWatermarkLogo(wp.ImageURL); err == nil {
			applyImageWatermark(canvas, logoImg, wp)
		}
	} else {
		applyTextWatermark(canvas, wp)
	}

	var out bytes.Buffer
	outCT := "image/jpeg"
	if format == "png" {
		outCT = "image/png"
		_ = png.Encode(&out, canvas)
	} else {
		_ = jpeg.Encode(&out, canvas, &jpeg.Options{Quality: 88})
	}

	w.Header().Set("Content-Type", outCT)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", out.Len()))
	_, _ = w.Write(out.Bytes())
}

func fetchWatermarkLogo(rawURL string) (image.Image, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || isPrivateHost(u.Hostname()) {
		return nil, fmt.Errorf("invalid watermark logo url")
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(u.String())
	if err != nil || resp.StatusCode >= 400 {
		return nil, fmt.Errorf("fetch logo failed")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	return img, err
}

func applyImageWatermark(dst *image.RGBA, logo image.Image, wp *models.WatermarkPreset) {
	dw, dh := dst.Bounds().Dx(), dst.Bounds().Dy()
	scale := wp.Scale
	if scale <= 0.05 || scale > 0.8 {
		scale = 0.22
	}
	targetW := int(float64(dw) * scale)
	if targetW < 32 {
		targetW = 32
	}
	lb := logo.Bounds()
	targetH := int(float64(lb.Dy()) * float64(targetW) / math.Max(1, float64(lb.Dx())))
	if targetH < 16 {
		targetH = 16
	}

	scaled := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	xdraw.CatmullRom.Scale(scaled, scaled.Bounds(), logo, lb, draw.Over, nil)

	opacity := wp.Opacity
	if opacity <= 0 || opacity > 1 {
		opacity = 0.5
	}
	alphaMask := image.NewUniform(color.Alpha{A: uint8(opacity * 255)})

	if wp.Tiled {
		stepX := targetW + maxIntVal(40, dw/8)
		stepY := targetH + maxIntVal(40, dh/8)
		for y := 24; y < dh; y += stepY {
			for x := 24; x < dw; x += stepX {
				r := image.Rect(x, y, x+targetW, y+targetH)
				draw.DrawMask(dst, r, scaled, image.Point{}, alphaMask, image.Point{}, draw.Over)
			}
		}
		return
	}

	x, y := computeGridPos(dw, dh, targetW, targetH, wp.Position, wp.OffsetX, wp.OffsetY)
	draw.DrawMask(dst, image.Rect(x, y, x+targetW, y+targetH), scaled, image.Point{}, alphaMask, image.Point{}, draw.Over)
}

func applyTextWatermark(dst *image.RGBA, wp *models.WatermarkPreset) {
	text := strings.TrimSpace(wp.TextContent)
	if text == "" {
		text = "Lumina Gallery"
	}
	// Render base bitmap text using basicfont, then scale smoothly to requested FontSize
	face := basicfont.Face7x13
	textW := font.MeasureString(face, text).Ceil()
	if textW <= 0 {
		textW = len([]rune(text)) * 7
	}
	baseH := 18
	pad := 4
	small := image.NewRGBA(image.Rect(0, 0, textW+pad*2, baseH))

	rCol, gCol, bCol := parseWatermarkColor(wp.TextColor)
	opacity := wp.Opacity
	if opacity <= 0 || opacity > 1 {
		opacity = 0.55
	}
	alpha := uint8(opacity * 255)
	shadowAlpha := uint8(opacity * 150)

	// Subtle drop-shadow for contrast on light backgrounds
	sd := &font.Drawer{
		Dst:  small,
		Src:  image.NewUniform(color.NRGBA{R: 0, G: 0, B: 0, A: shadowAlpha}),
		Face: face,
		Dot:  fixed.P(pad+1, 14),
	}
	sd.DrawString(text)

	d := &font.Drawer{
		Dst:  small,
		Src:  image.NewUniform(color.NRGBA{R: rCol, G: gCol, B: bCol, A: alpha}),
		Face: face,
		Dot:  fixed.P(pad, 13),
	}
	d.DrawString(text)

	fontSize := wp.FontSize
	if fontSize < 12 {
		fontSize = 24
	}
	dw, dh := dst.Bounds().Dx(), dst.Bounds().Dy()
	// Scale factor proportional to fontSize (relative to 13px basicfont height)
	scaleFactor := float64(fontSize) / 13.0
	if dw > 1600 {
		scaleFactor *= float64(dw) / 1400.0
	}
	tw := int(float64(small.Bounds().Dx()) * scaleFactor)
	th := int(float64(small.Bounds().Dy()) * scaleFactor)
	if tw > dw-24 {
		ratio := float64(dw-24) / math.Max(1, float64(tw))
		tw = int(float64(tw) * ratio)
		th = maxIntVal(12, int(float64(th)*ratio))
	}

	scaled := image.NewRGBA(image.Rect(0, 0, maxIntVal(1, tw), maxIntVal(1, th)))
	xdraw.BiLinear.Scale(scaled, scaled.Bounds(), small, small.Bounds(), draw.Over, nil)

	if wp.Tiled {
		stepX := tw + maxIntVal(60, dw/6)
		stepY := th + maxIntVal(60, dh/6)
		for y := 24; y < dh; y += stepY {
			for x := 24; x < dw; x += stepX {
				draw.Draw(dst, image.Rect(x, y, x+tw, y+th), scaled, image.Point{}, draw.Over)
			}
		}
		return
	}

	x, y := computeGridPos(dw, dh, tw, th, wp.Position, wp.OffsetX, wp.OffsetY)
	draw.Draw(dst, image.Rect(x, y, x+tw, y+th), scaled, image.Point{}, draw.Over)
}

func computeGridPos(dw, dh, w, h int, pos string, offX, offY int) (int, int) {
	margin := maxIntVal(16, dw/40)
	var x, y int
	switch pos {
	case "nowe":
		x, y = margin, margin
	case "no":
		x, y = (dw-w)/2, margin
	case "noea":
		x, y = dw-w-margin, margin
	case "we":
		x, y = margin, (dh-h)/2
	case "ce":
		x, y = (dw-w)/2, (dh-h)/2
	case "ea":
		x, y = dw-w-margin, (dh-h)/2
	case "sowe":
		x, y = margin, dh-h-margin
	case "so":
		x, y = (dw-w)/2, dh-h-margin
	default: // "soea"
		x, y = dw-w-margin, dh-h-margin
	}
	return x + offX, y + offY
}

func parseWatermarkColor(hex string) (uint8, uint8, uint8) {
	hex = strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(hex) != 6 {
		return 255, 255, 255
	}
	r, _ := strconv.ParseUint(hex[0:2], 16, 8)
	g, _ := strconv.ParseUint(hex[2:4], 16, 8)
	b, _ := strconv.ParseUint(hex[4:6], 16, 8)
	return uint8(r), uint8(g), uint8(b)
}

func maxIntVal(a, b int) int {
	if a > b {
		return a
	}
	return b
}
