package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetHooksAddsOnceAndKeepsOthers(t *testing.T) {
	s := map[string]any{"hooks": map[string]any{
		"Stop": []any{map[string]any{"hooks": []any{map[string]any{"type": "command", "command": "other.sh"}}}},
	}}
	SetHooks(s, "/bin/ai-cockpit-agent", false)
	SetHooks(s, "/bin/ai-cockpit-agent", false) // idempotent
	stop := s["hooks"].(map[string]any)["Stop"].([]any)
	if len(stop) != 2 {
		t.Fatalf("Stop entries = %d, want 2 (other + ours)", len(stop))
	}
	if len(s["hooks"].(map[string]any)) != 8 {
		t.Fatalf("hook types = %d, want 8", len(s["hooks"].(map[string]any)))
	}
	SetHooks(s, "/bin/ai-cockpit-agent", true)
	if got := s["hooks"].(map[string]any); len(got) != 1 || len(got["Stop"].([]any)) != 1 {
		t.Fatalf("after uninstall = %v, want only the foreign Stop hook", got)
	}
}

// End to end: a TLS server with a self-signed cert, connect pins it, hook delivers with the token.
func TestConnectPinsAndHookDelivers(t *testing.T) {
	got := make(chan map[string]any, 1)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/hooks/event" {
			if r.Header.Get("x-ccam-hook-token") != "tok" {
				w.WriteHeader(401)
				return
			}
			var m map[string]any
			_ = json.NewDecoder(r.Body).Decode(&m)
			got <- m
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	bin := filepath.Join(dir, "agent")
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	env := append(os.Environ(), "AI_COCKPIT_AGENT_CONFIG="+filepath.Join(dir, "cfg.json"))
	fp := Fingerprint(srv.Certificate().Raw)

	bad := exec.Command(bin, "connect", srv.URL, "tok", strings.Repeat("AA:", 31)+"AA")
	bad.Env = env
	if err := bad.Run(); err == nil {
		t.Fatal("connect with a wrong fingerprint must fail")
	}

	ok := exec.Command(bin, "connect", srv.URL, "tok", fp)
	ok.Env = env
	if out, err := ok.CombinedOutput(); err != nil {
		t.Fatalf("connect: %v\n%s", err, out)
	}

	h := exec.Command(bin, "hook", "PreToolUse")
	h.Env = env
	h.Stdin = strings.NewReader(`{"session_id":"s1","tool_name":"Bash"}`)
	if err := h.Run(); err != nil {
		t.Fatalf("hook exit: %v", err)
	}
	m := <-got
	if m["hook_type"] != "PreToolUse" || m["data"].(map[string]any)["session_id"] != "s1" {
		t.Fatalf("payload = %v", m)
	}
}
