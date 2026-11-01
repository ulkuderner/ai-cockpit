// Command ai-cockpit-agent forwards live Claude Code hook events from an agent machine to a
// remote AI Cockpit over HTTPS. It is a single static binary (no Node or cockpit checkout on
// the agent machine) and starts in milliseconds, which matters because Claude Code spawns one
// process per hook event.
//
// Usage:
//
//	ai-cockpit-agent connect <https-url> <hook-token> [<sha256-fingerprint>]
//	ai-cockpit-agent install      add hooks to ~/.claude/settings.json (backup first)
//	ai-cockpit-agent uninstall    remove them again
//	ai-cockpit-agent status
//	ai-cockpit-agent disconnect
//	ai-cockpit-agent hook <EventName>   (called by Claude Code; reads the event JSON on stdin)
//
// Author: Caglar Ulkuderner. License: GPL-3.0-or-later.
package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type config struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	// PEM of the pinned server certificate; empty means "use the system CAs" (e.g. *.ts.net).
	CertPEM string `json:"cert_pem,omitempty"`
}

var hooksWithMatcher = []string{"PreToolUse", "PostToolUse", "Stop", "SubagentStop", "Notification"}
var hooksWithoutMatcher = []string{"SessionStart", "SessionEnd", "UserPromptSubmit"}

const marker = "ai-cockpit-agent"

func home() string {
	h, err := os.UserHomeDir()
	if err != nil {
		fail("ev dizini bulunamadı: %v", err)
	}
	return h
}

func configPath() string {
	if p := os.Getenv("AI_COCKPIT_AGENT_CONFIG"); p != "" {
		return p
	}
	return filepath.Join(home(), ".ai-cockpit-agent", "config.json")
}

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}

func loadConfig() (*config, error) {
	b, err := os.ReadFile(configPath())
	if err != nil {
		return nil, err
	}
	var c config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func saveConfig(c *config) error {
	p := configPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// Fingerprint formats a certificate's SHA-256 like `openssl x509 -fingerprint -sha256`.
func Fingerprint(der []byte) string {
	sum := sha256.Sum256(der)
	parts := make([]string, len(sum))
	for i, b := range sum {
		parts[i] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(parts, ":")
}

func normalizeFingerprint(s string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(s), " ", ""))
}

func tlsConfig(c *config) (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if c.CertPEM != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(c.CertPEM)) {
			return nil, errors.New("sabitlenmiş sertifika okunamadı")
		}
		cfg.RootCAs = pool
	}
	return cfg, nil
}

func client(c *config, timeout time.Duration) (*http.Client, error) {
	tc, err := tlsConfig(c)
	if err != nil {
		return nil, err
	}
	return &http.Client{Timeout: timeout, Transport: &http.Transport{TLSClientConfig: tc}}, nil
}

func connect(args []string) {
	if len(args) < 2 {
		fail("Kullanım: ai-cockpit-agent connect <https-adresi> <hook-anahtarı> [<sha256-parmak-izi>]")
	}
	u, err := url.Parse(args[0])
	if err != nil || u.Scheme != "https" || u.Host == "" {
		fail("Adres https:// ile başlamalı; veri yalnız şifreli kanaldan gönderilir.")
	}
	host := u.Hostname()
	port := u.Port()
	if port == "" {
		port = "443"
	}
	c := &config{URL: strings.TrimRight(u.String(), "/"), Token: args[1]}

	if strings.HasSuffix(host, ".ts.net") {
		// Tailscale names carry a real, regularly renewed certificate: trust the system CAs.
		fmt.Println("Tailscale adresi: sistem sertifikalarına güveniliyor.")
	} else {
		// Self-signed cockpit certificate: the fingerprint printed by `ai-cockpit start --remote` is required,
		// so a first connection can never silently trust an impostor.
		if len(args) < 3 {
			fail("Parmak izi gerekli: kokpitin yazdığı SHA256 değerini üçüncü argüman olarak ver.")
		}
		conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 5 * time.Second}, "tcp", net.JoinHostPort(host, port),
			// Verification is done right below by comparing the leaf with the user-supplied fingerprint.
			&tls.Config{InsecureSkipVerify: true, ServerName: host}) // #nosec G402
		if err != nil {
			fail("%s adresine TLS bağlantısı kurulamadı: %v", c.URL, err)
		}
		leaf := conn.ConnectionState().PeerCertificates[0]
		conn.Close()
		got := Fingerprint(leaf.Raw)
		if normalizeFingerprint(args[2]) != got {
			fail("Parmak izi uyuşmuyor! Beklenen %s, gelen %s. Bağlanılmadı.", normalizeFingerprint(args[2]), got)
		}
		c.CertPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf.Raw}))
		fmt.Printf("Sertifika doğrulandı ve sabitlendi: SHA256 %s\n", got)
	}
	if err := saveConfig(c); err != nil {
		fail("ayar kaydedilemedi: %v", err)
	}
	cl, err := client(c, 5*time.Second)
	if err != nil {
		fail("%v", err)
	}
	resp, err := cl.Get(c.URL + "/api/health")
	if err != nil {
		fmt.Printf("Kayıt tamam ama %s şu an yanıt vermiyor (%v); kokpit açılınca olaylar akar.\n", c.URL, err)
	} else {
		resp.Body.Close()
		fmt.Printf("Bağlandı: %s (HTTP %d).\n", c.URL, resp.StatusCode)
	}
	fmt.Println("Sırada: ai-cockpit-agent install (Claude Code hook'larını ekler).")
}

// hook sends one event and always exits 0: a monitoring failure must never block the agent.
func hook(args []string) {
	defer os.Exit(0)
	if len(args) < 1 {
		return
	}
	c, err := loadConfig()
	if err != nil || c.URL == "" {
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(os.Stdin, 8<<20))
	var data any
	if json.Unmarshal(raw, &data) != nil {
		data = map[string]string{"raw": string(raw)}
	}
	body, _ := json.Marshal(map[string]any{"hook_type": args[0], "data": data})
	cl, err := client(c, 2*time.Second)
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, c.URL+"/api/hooks/event", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-ccam-hook-token", c.Token)
	if resp, err := cl.Do(req); err == nil {
		resp.Body.Close()
	}
}

func settingsPath() string {
	if p := os.Getenv("CLAUDE_SETTINGS"); p != "" {
		return p
	}
	return filepath.Join(home(), ".claude", "settings.json")
}

func readSettings() (map[string]any, []byte) {
	b, err := os.ReadFile(settingsPath())
	if errors.Is(err, os.ErrNotExist) {
		return map[string]any{}, nil
	}
	if err != nil {
		fail("ayar dosyası okunamadı: %v", err)
	}
	s := map[string]any{}
	if len(bytes.TrimSpace(b)) > 0 {
		if err := json.Unmarshal(b, &s); err != nil {
			fail("%s geçerli JSON değil, dokunulmadı: %v", settingsPath(), err)
		}
	}
	return s, b
}

func writeSettings(s map[string]any, original []byte) {
	p := settingsPath()
	if original != nil {
		if err := os.WriteFile(p+".ai-cockpit-agent.bak", original, 0o600); err != nil {
			fail("yedek alınamadı, dokunulmadı: %v", err)
		}
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		fail("%v", err)
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	if err := os.WriteFile(p, append(b, '\n'), 0o600); err != nil {
		fail("ayar yazılamadı: %v", err)
	}
}

func isOurs(entry any) bool {
	m, ok := entry.(map[string]any)
	if !ok {
		return false
	}
	hs, _ := m["hooks"].([]any)
	for _, h := range hs {
		if hm, ok := h.(map[string]any); ok {
			if cmd, _ := hm["command"].(string); strings.Contains(cmd, marker) {
				return true
			}
		}
	}
	return false
}

// SetHooks adds (or with remove=true drops) our entries for every hook type, leaving other hooks intact.
func SetHooks(s map[string]any, bin string, remove bool) {
	hooks, _ := s["hooks"].(map[string]any)
	if hooks == nil {
		hooks = map[string]any{}
	}
	add := func(event string, matcher bool) {
		list, _ := hooks[event].([]any)
		kept := make([]any, 0, len(list)+1)
		for _, e := range list {
			if !isOurs(e) {
				kept = append(kept, e)
			}
		}
		if !remove {
			entry := map[string]any{"hooks": []any{map[string]any{
				"type": "command", "command": fmt.Sprintf("%q hook %s", bin, event),
			}}}
			if matcher {
				entry["matcher"] = "*"
			}
			kept = append(kept, entry)
		}
		if len(kept) == 0 {
			delete(hooks, event)
		} else {
			hooks[event] = kept
		}
	}
	for _, e := range hooksWithMatcher {
		add(e, true)
	}
	for _, e := range hooksWithoutMatcher {
		add(e, false)
	}
	s["hooks"] = hooks
}

func install(remove bool) {
	bin, err := os.Executable()
	if err != nil {
		fail("%v", err)
	}
	bin, _ = filepath.EvalSymlinks(bin)
	s, original := readSettings()
	SetHooks(s, bin, remove)
	writeSettings(s, original)
	if remove {
		fmt.Printf("Hook'lar kaldırıldı: %s (yedek: .ai-cockpit-agent.bak)\n", settingsPath())
	} else {
		fmt.Printf("Hook'lar eklendi: %s (yedek: .ai-cockpit-agent.bak). Yeni Claude Code oturumları olay göndermeye başlar.\n", settingsPath())
	}
}

func status() {
	c, err := loadConfig()
	if err != nil {
		fmt.Println("Bağlı değil. ai-cockpit-agent connect <https-adresi> <hook-anahtarı> [<parmak-izi>]")
		return
	}
	pin := "sistem sertifikaları"
	if c.CertPEM != "" {
		if b, _ := pem.Decode([]byte(c.CertPEM)); b != nil {
			pin = "SHA256 " + Fingerprint(b.Bytes)
		}
	}
	fmt.Printf("Kokpit: %s\nGüven: %s\n", c.URL, pin)
	s, _ := readSettings()
	n := 0
	if hooks, ok := s["hooks"].(map[string]any); ok {
		for _, list := range hooks {
			if l, ok := list.([]any); ok {
				for _, e := range l {
					if isOurs(e) {
						n++
					}
				}
			}
		}
	}
	fmt.Printf("Kurulu hook: %d/%d\n", n, len(hooksWithMatcher)+len(hooksWithoutMatcher))
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Kullanım: ai-cockpit-agent connect|install|uninstall|status|disconnect|hook")
		os.Exit(2)
	}
	args := os.Args[2:]
	switch os.Args[1] {
	case "connect":
		connect(args)
	case "install":
		install(false)
	case "uninstall":
		install(true)
	case "status":
		status()
	case "disconnect":
		_ = os.Remove(configPath())
		fmt.Println("Bağlantı kaldırıldı; hook'lar artık sessizce hiçbir şey göndermez.")
	case "hook":
		hook(args)
	default:
		fail("Bilinmeyen komut: %s", os.Args[1])
	}
}
