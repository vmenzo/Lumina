package mail

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"

	"lumina-imagehost/internal/config"
)

func IsConfigured(cfg *config.Config) bool {
	return strings.TrimSpace(cfg.SMTPHost) != "" && cfg.SMTPPort > 0
}

// SendHTML sends an HTML email via SMTP (supports SSL/TLS on 465 and STARTTLS on 587/25).
func SendHTML(cfg *config.Config, to, subject, htmlBody string) error {
	if !IsConfigured(cfg) {
		return errors.New("SMTP 邮件服务尚未配置（请在 .env 中填写 SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS）")
	}
	from := cfg.SMTPFrom
	if from == "" {
		from = cfg.SMTPUser
	}
	if from == "" {
		from = "noreply@lumina.local"
	}

	msg := strings.Join([]string{
		fmt.Sprintf("From: Lumina 光匣 <%s>", from),
		fmt.Sprintf("To: %s", to),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		`Content-Type: text/html; charset="UTF-8"`,
		"",
		htmlBody,
	}, "\r\n")

	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, cfg.SMTPPort)
	var auth smtp.Auth
	if cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPHost)
	}

	// Implicit TLS (port 465)
	if cfg.SMTPPort == 465 {
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		conn, err := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{ServerName: cfg.SMTPHost})
		if err != nil {
			return err
		}
		client, err := smtp.NewClient(conn, cfg.SMTPHost)
		if err != nil {
			return err
		}
		defer client.Close()
		if auth != nil {
			if err := client.Auth(auth); err != nil {
				return err
			}
		}
		if err := client.Mail(from); err != nil {
			return err
		}
		if err := client.Rcpt(to); err != nil {
			return err
		}
		wc, err := client.Data()
		if err != nil {
			return err
		}
		if _, err := wc.Write([]byte(msg)); err != nil {
			return err
		}
		_ = wc.Close()
		return client.Quit()
	}

	// STARTTLS / Plain SMTP (587, 25, etc.)
	return smtp.SendMail(addr, auth, from, []string{to}, []byte(msg))
}
