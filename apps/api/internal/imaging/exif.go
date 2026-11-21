package imaging

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"
)

// ParseJPEGExif extracts sanitized camera shooting parameters (Make, Model, Lens, Aperture, Shutter, ISO, FocalLength, DateTime)
// from a JPEG APP1 EXIF header in pure Go, strictly ignoring GPS IFD tags for privacy.
func ParseJPEGExif(data []byte) map[string]string {
	res := map[string]string{}
	if len(data) < 12 || data[0] != 0xFF || data[1] != 0xD8 {
		return res
	}

	pos := 2
	for pos+4 < len(data) {
		if data[pos] != 0xFF {
			break
		}
		marker := data[pos+1]
		if marker == 0xDA || marker == 0xD9 {
			break
		}
		segLen := int(binary.BigEndian.Uint16(data[pos+2 : pos+4]))
		if segLen < 2 || pos+2+segLen > len(data) {
			break
		}
		if marker == 0xE1 && segLen > 8 && bytes.Equal(data[pos+4:pos+10], []byte("Exif\x00\x00")) {
			parseTIFF(data[pos+10:pos+2+segLen], res)
			break
		}
		pos += 2 + segLen
	}
	return res
}

func parseTIFF(tiff []byte, out map[string]string) {
	if len(tiff) < 8 {
		return
	}
	var bo binary.ByteOrder
	if tiff[0] == 'I' && tiff[1] == 'I' {
		bo = binary.LittleEndian
	} else if tiff[0] == 'M' && tiff[1] == 'M' {
		bo = binary.BigEndian
	} else {
		return
	}
	if bo.Uint16(tiff[2:4]) != 42 {
		return
	}
	ifd0Off := int(bo.Uint32(tiff[4:8]))
	exifOff := readIFD(tiff, bo, ifd0Off, out, false)
	if exifOff > 0 {
		readIFD(tiff, bo, exifOff, out, true)
	}
}

func readIFD(tiff []byte, bo binary.ByteOrder, off int, out map[string]string, isExif bool) int {
	if off < 0 || off+2 > len(tiff) {
		return 0
	}
	count := int(bo.Uint16(tiff[off : off+2]))
	exifSubIFD := 0

	for i := 0; i < count; i++ {
		eOff := off + 2 + i*12
		if eOff+12 > len(tiff) {
			break
		}
		tag := bo.Uint16(tiff[eOff : eOff+2])
		typ := bo.Uint16(tiff[eOff+2 : eOff+4])
		cnt := int(bo.Uint32(tiff[eOff+4 : eOff+8]))
		valOff := eOff + 8

		// Strictly skip GPS IFD pointer (0x8825)
		if tag == 0x8825 {
			continue
		}
		if !isExif && tag == 0x8769 {
			exifSubIFD = int(bo.Uint32(tiff[valOff : valOff+4]))
			continue
		}

		if !isExif {
			switch tag {
			case 0x010F:
				if s := readASCII(tiff, bo, typ, cnt, valOff); s != "" {
					out["Make"] = s
				}
			case 0x0110:
				if s := readASCII(tiff, bo, typ, cnt, valOff); s != "" {
					out["Model"] = s
				}
			}
		} else {
			switch tag {
			case 0x829A:
				if num, den, ok := readRational(tiff, bo, typ, valOff); ok && den > 0 {
					if num < den && num > 0 {
						out["Exposure"] = fmt.Sprintf("1/%ds", den/num)
					} else {
						out["Exposure"] = fmt.Sprintf("%.2fs", float64(num)/float64(den))
					}
				}
			case 0x829D:
				if num, den, ok := readRational(tiff, bo, typ, valOff); ok && den > 0 {
					out["Aperture"] = fmt.Sprintf("f/%.1f", float64(num)/float64(den))
				}
			case 0x8827:
				if typ == 3 && cnt >= 1 {
					out["ISO"] = fmt.Sprintf("%d", bo.Uint16(tiff[valOff:valOff+2]))
				}
			case 0x920A:
				if num, den, ok := readRational(tiff, bo, typ, valOff); ok && den > 0 {
					out["FocalLength"] = fmt.Sprintf("%.0fmm", float64(num)/float64(den))
				}
			case 0x9003:
				if s := readASCII(tiff, bo, typ, cnt, valOff); s != "" {
					out["TakenAt"] = s
				}
			case 0xA434:
				if s := readASCII(tiff, bo, typ, cnt, valOff); s != "" {
					out["Lens"] = s
				}
			}
		}
	}
	return exifSubIFD
}

func readASCII(tiff []byte, bo binary.ByteOrder, typ uint16, cnt int, valOff int) string {
	if typ != 2 || cnt <= 0 || cnt > 256 {
		return ""
	}
	var raw []byte
	if cnt <= 4 {
		raw = tiff[valOff : valOff+cnt]
	} else {
		p := int(bo.Uint32(tiff[valOff : valOff+4]))
		if p < 0 || p+cnt > len(tiff) {
			return ""
		}
		raw = tiff[p : p+cnt]
	}
	return strings.TrimSpace(strings.TrimRight(string(raw), "\x00"))
}

func readRational(tiff []byte, bo binary.ByteOrder, typ uint16, valOff int) (uint32, uint32, bool) {
	if typ != 5 {
		return 0, 0, false
	}
	p := int(bo.Uint32(tiff[valOff : valOff+4]))
	if p < 0 || p+8 > len(tiff) {
		return 0, 0, false
	}
	return bo.Uint32(tiff[p : p+4]), bo.Uint32(tiff[p+4 : p+8]), true
}
