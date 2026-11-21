package imaging

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"sort"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"

	"lumina-imagehost/internal/config"
)

type ImageMeta struct {
	Width         int
	Height        int
	DominantColor string
	ColorPalette  []string
	ExifData      map[string]string
}

// Inspect decodes image dimensions, extracts sanitized EXIF metadata (no GPS), and computes a 5-color palette.
func Inspect(r io.Reader) ImageMeta {
	meta := ImageMeta{
		DominantColor: "#64748b",
		ColorPalette:  []string{"#64748b", "#94a3b8", "#334155", "#cbd5e1", "#1e293b"},
		ExifData:      map[string]string{},
	}
	raw, err := io.ReadAll(io.LimitReader(r, 64*1024*1024))
	if err != nil || len(raw) == 0 {
		return meta
	}

	meta.ExifData = ParseJPEGExif(raw)

	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return meta
	}
	b := img.Bounds()
	meta.Width = b.Dx()
	meta.Height = b.Dy()

	type bucket struct {
		rSum, gSum, bSum uint64
		count            uint64
	}
	buckets := make(map[uint32]*bucket)
	stepX := maxInt(1, meta.Width/32)
	stepY := maxInt(1, meta.Height/32)

	for y := b.Min.Y; y < b.Max.Y; y += stepY {
		for x := b.Min.X; x < b.Max.X; x += stepX {
			cr, cg, cb, ca := img.At(x, y).RGBA()
			if ca < 0x8000 {
				continue
			}
			r8 := uint8(cr >> 8)
			g8 := uint8(cg >> 8)
			b8 := uint8(cb >> 8)
			key := (uint32(r8>>5) << 6) | (uint32(g8>>5) << 3) | uint32(b8>>5)
			bk, ok := buckets[key]
			if !ok {
				bk = &bucket{}
				buckets[key] = bk
			}
			bk.rSum += uint64(r8)
			bk.gSum += uint64(g8)
			bk.bSum += uint64(b8)
			bk.count++
		}
	}

	list := make([]*bucket, 0, len(buckets))
	for _, bk := range buckets {
		list = append(list, bk)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].count > list[j].count })

	if len(list) > 0 {
		palette := make([]string, 0, 5)
		for i := 0; i < len(list) && i < 5; i++ {
			bk := list[i]
			hx := fmt.Sprintf("#%02x%02x%02x", bk.rSum/bk.count, bk.gSum/bk.count, bk.bSum/bk.count)
			palette = append(palette, hx)
		}
		meta.DominantColor = palette[0]
		meta.ColorPalette = palette
	}
	return meta
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// BuildImgproxyURL generates HMAC-SHA256 signed imgproxy URLs for local or S3/R2 objects.
func BuildImgproxyURL(cfg *config.Config, engine, objectKey, processingOpts, ext string) string {
	var srcURI string
	if engine == "r2" && cfg.R2Bucket != "" {
		srcURI = fmt.Sprintf("s3://%s/%s", cfg.R2Bucket, objectKey)
	} else {
		srcURI = fmt.Sprintf("local:///%s", objectKey)
	}
	encodedSrc := base64.RawURLEncoding.EncodeToString([]byte(srcURI))
	path := fmt.Sprintf("/%s/%s.%s", processingOpts, encodedSrc, ext)

	sig := "insecure"
	keyBin, errK := hex.DecodeString(cfg.ImgproxyKey)
	saltBin, errS := hex.DecodeString(cfg.ImgproxySalt)
	if errK == nil && errS == nil && len(keyBin) > 0 && len(saltBin) > 0 {
		mac := hmac.New(sha256.New, keyBin)
		mac.Write(saltBin)
		mac.Write([]byte(path))
		sig = base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	}
	return fmt.Sprintf("%s/img/%s%s", cfg.CDNPublicURL, sig, path)
}
