#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3000}"
BASE_URL="http://127.0.0.1:${PORT}"
NODE_PATH_PREFIX="${ROOT_DIR}/.node/bin"
export PATH="${NODE_PATH_PREFIX}:$PATH"

SERVER_PID=""
STARTED_SERVER=0
TESTS_PASSED=0
TESTS_FAILED=0

cleanup() {
  if [[ "$STARTED_SERVER" -eq 1 ]] && [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log() {
  printf '%s\n' "$*"
}

pass() {
  TESTS_PASSED=$((TESTS_PASSED + 1))
  log "PASS: $*"
}

fail() {
  TESTS_FAILED=$((TESTS_FAILED + 1))
  log "FAIL: $*"
}

split_http_response() {
  local response="$1"
  HTTP_STATUS="$(printf '%s\n' "$response" | sed -n 's/^HTTP_STATUS://p' | tail -n1)"
  HTTP_BODY="$(printf '%s\n' "$response" | sed '/^HTTP_STATUS:/d')"
}

http_json() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"

  if [[ -n "$payload" ]]; then
    curl -sS -X "$method" "$url" -H 'content-type: application/json' -d "$payload" -w '\nHTTP_STATUS:%{http_code}\n'
  else
    curl -sS -X "$method" "$url" -H 'content-type: application/json' -w '\nHTTP_STATUS:%{http_code}\n'
  fi
}

assert_http_status() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  local body="$4"

  if [[ "$actual" == "$expected" ]]; then
    pass "$name (HTTP $actual)"
  else
    fail "$name (expected HTTP $expected, got $actual) body=$(printf '%s' "$body" | tr '\n' ' ' | head -c 240)"
  fi
}

ensure_server() {
  if curl -sS "$BASE_URL/api/jobs" >/dev/null 2>&1; then
    log "Reusing existing server on ${BASE_URL}"
    return
  fi

  log "No server detected on ${BASE_URL}; starting local server"
  (cd "$ROOT_DIR" && npm run build >/tmp/kotak-supers-test-build.log 2>&1)
  cd "$ROOT_DIR"
  PORT="$PORT" npm run start >/tmp/kotak-supers-test-start.log 2>&1 &
  SERVER_PID=$!
  STARTED_SERVER=1

  for _ in $(seq 1 40); do
    if curl -sS "$BASE_URL/api/jobs" >/dev/null 2>&1; then
      log "Server ready on ${BASE_URL}"
      return
    fi
    sleep 1
  done

  log "Server failed to start"
  tail -n 120 /tmp/kotak-supers-test-start.log || true
  exit 1
}

wait_for_job_completion() {
  local job_id="$1"
  local label="$2"

  for i in $(seq 1 180); do
    local raw
    raw="$(curl -sS "$BASE_URL/api/jobs/$job_id")"
    local status
    status="$(printf '%s' "$raw" | ruby -rjson -e 'j=JSON.parse(STDIN.read); puts j.dig("job","status").to_s')"
    local steps
    steps="$(printf '%s' "$raw" | ruby -rjson -e 'j=JSON.parse(STDIN.read); puts (j.dig("job","steps") || []).map{|s| "#{s["id"]}:#{s["status"]}"}.join(",")')"
    local error
    error="$(printf '%s' "$raw" | ruby -rjson -e 'j=JSON.parse(STDIN.read); puts j.dig("job","error").to_s')"

    log "${label} poll ${i}: status=${status} steps=${steps} error=${error:-none}"

    if [[ "$status" == "completed" ]]; then
      pass "${label} completed"
      printf '%s' "$raw"
      return 0
    fi

    if [[ "$status" == "failed" ]]; then
      fail "${label} failed with error: ${error}"
      printf '%s' "$raw"
      return 1
    fi

    sleep 5
  done

  fail "${label} timed out"
  return 1
}

assert_inline_supers_debug() {
  local job_id="$1"
  local label="$2"
  local expected_min_cues="$3"
  local debug_path="${ROOT_DIR}/generated/${job_id}/supers-debug.json"

  if [[ ! -f "$debug_path" ]]; then
    fail "${label} missing supers-debug.json"
    return 1
  fi

  local summary
  summary="$(ruby -rjson -e '
    j = JSON.parse(File.read(ARGV[0]))
    cue_count = j["cueCount"].to_i
    inline_violations = j["inlineTextViolations"].to_i
    cue_newline_violations = (j["cues"] || []).count { |c| c["text"].to_s.match?(/[\r\n]/) }
    mode_used = j["modeUsed"].to_s
    puts({cue_count: cue_count, inline_violations: inline_violations, cue_newline_violations: cue_newline_violations, mode_used: mode_used}.to_json)
  ' "$debug_path")"

  local cue_count
  cue_count="$(printf '%s' "$summary" | ruby -rjson -e 'j=JSON.parse(STDIN.read); puts j["cue_count"]')"
  local inline_violations
  inline_violations="$(printf '%s' "$summary" | ruby -rjson -e 'j=JSON.parse(STDIN.read); puts j["inline_violations"]')"
  local cue_newline_violations
  cue_newline_violations="$(printf '%s' "$summary" | ruby -rjson -e 'j=JSON.parse(STDIN.read); puts j["cue_newline_violations"]')"

  if (( cue_count < expected_min_cues )); then
    fail "${label} cue count too low (expected >= ${expected_min_cues}, got ${cue_count})"
  else
    pass "${label} cue count OK (${cue_count})"
  fi

  if (( inline_violations == 0 && cue_newline_violations == 0 )); then
    pass "${label} supers text is inline (no newline violations)"
  else
    fail "${label} supers text newline violations detected (inline=${inline_violations}, cue=${cue_newline_violations})"
  fi
}

run_validation_cases() {
  log "Running validation/edge API cases"

  local resp

  resp="$(http_json POST "$BASE_URL/api/jobs" '{"product":"invalid_product","script":"This is a valid length script for testing invalid product behavior."}')"
  split_http_response "$resp"
  assert_http_status "Invalid product rejected" "400" "$HTTP_STATUS" "$HTTP_BODY"

  resp="$(http_json POST "$BASE_URL/api/jobs" '{"product":"kotak_air_plus","script":"short"}')"
  split_http_response "$resp"
  assert_http_status "Too-short script rejected" "400" "$HTTP_STATUS" "$HTTP_BODY"

  resp="$(http_json POST "$BASE_URL/api/jobs" '{"product":"kotak_air_plus","script":"This script is long enough but has invalid supers hold seconds.","supers":{"enabled":true,"timingMode":"fast","template":"bottom_urgency","rules":[{"triggerWord":"travel","text":"5% on travel","holdSeconds":0.5}]}}')"
  split_http_response "$resp"
  assert_http_status "Invalid holdSeconds rejected" "400" "$HTTP_STATUS" "$HTTP_BODY"

  resp="$(http_json POST "$BASE_URL/api/jobs" '{"product":"kotak_cashback","script":"This script is long enough but has invalid supers template.","supers":{"enabled":true,"timingMode":"fast","template":"top_banner","rules":[]}}')"
  split_http_response "$resp"
  assert_http_status "Invalid supers template rejected" "400" "$HTTP_STATUS" "$HTTP_BODY"

  resp="$(http_json POST "$BASE_URL/api/jobs" '{"product":"kotak_cashback","script":"This script is long enough but has invalid supers timing mode.","supers":{"enabled":true,"timingMode":"slow","template":"bottom_urgency","rules":[]}}')"
  split_http_response "$resp"
  assert_http_status "Invalid supers timing mode rejected" "400" "$HTTP_STATUS" "$HTTP_BODY"

  local many_rules
  many_rules="$(ruby -rjson -e 'rules=(1..13).map{|i| {triggerWord:"t#{i}", text:"x#{i}"}}; puts({product:"kotak_air_plus", script:"This script is long enough to trigger max rule validation behavior.", supers:{enabled:true,timingMode:"fast",template:"bottom_urgency",rules:rules}}.to_json)')"
  resp="$(http_json POST "$BASE_URL/api/jobs" "$many_rules")"
  split_http_response "$resp"
  assert_http_status "Supers rules max length enforced" "400" "$HTTP_STATUS" "$HTTP_BODY"
}

run_live_supers_cases() {
  log "Running live supers pipeline cases"

  local air_payload
  air_payload='{"product":"kotak_air_plus","script":"Travel this quarter and earn 5% rewards on travel bookings via Kotak Unbox, with joining fee INR 0 for a limited period and a complimentary flight at INR 1.5L spend. Apply now.","guidelines":"Keep claims compliant and use urgency-led BOFU tone.","supers":{"enabled":true,"timingMode":"fast","template":"bottom_urgency","rules":[]}}'

  local air_resp
  air_resp="$(http_json POST "$BASE_URL/api/jobs" "$air_payload")"
  split_http_response "$air_resp"
  assert_http_status "Air+ supers job accepted" "202" "$HTTP_STATUS" "$HTTP_BODY"
  local air_job_id
  air_job_id="$(printf '%s' "$HTTP_BODY" | ruby -rjson -e 'j=JSON.parse(STDIN.read); puts j.dig("job","id").to_s')"
  if [[ -z "$air_job_id" ]]; then
    fail "Air+ supers job id missing"
  else
    local air_final
    air_final="$(wait_for_job_completion "$air_job_id" "Air+ supers auto-rules")" || true
    if [[ -n "$air_final" ]]; then
      assert_inline_supers_debug "$air_job_id" "Air+ supers auto-rules" 1
    fi
  fi

  local cashback_payload
  cashback_payload="$(
    ruby -rjson <<'RUBY'
payload = {
  product: "kotak_cashback",
  script: "For daily essentials and entertainment, get 5% cashback and up to 4% benefit on fuel with limited-period joining fee INR 0. Apply now.",
  guidelines: "Use practical, utility-first language and stay compliant.",
  supers: {
    enabled: true,
    timingMode: "fast",
    template: "bottom_urgency",
    rules: [
      { triggerWord: "daily essentials", text: "5% cashback\non essentials", holdSeconds: 1.3 },
      { triggerWord: "fuel", text: "Up to 4% benefit on fuel", holdSeconds: 1.2 },
      { triggerWord: "joining fee", text: "Joining fee INR 0 (limited period)", holdSeconds: 1.1 }
    ]
  }
}

puts payload.to_json
RUBY
)"

  local cashback_resp
  cashback_resp="$(http_json POST "$BASE_URL/api/jobs" "$cashback_payload")"
  split_http_response "$cashback_resp"
  assert_http_status "Cashback supers manual-rules job accepted" "202" "$HTTP_STATUS" "$HTTP_BODY"
  local cashback_job_id
  cashback_job_id="$(printf '%s' "$HTTP_BODY" | ruby -rjson -e 'j=JSON.parse(STDIN.read); puts j.dig("job","id").to_s')"
  if [[ -z "$cashback_job_id" ]]; then
    fail "Cashback supers job id missing"
  else
    local cashback_final
    cashback_final="$(wait_for_job_completion "$cashback_job_id" "Cashback supers manual-rules")" || true
    if [[ -n "$cashback_final" ]]; then
      assert_inline_supers_debug "$cashback_job_id" "Cashback supers manual-rules" 1
    fi
  fi
}

main() {
  ensure_server
  run_validation_cases
  run_live_supers_cases

  log ""
  log "Test summary: passed=${TESTS_PASSED} failed=${TESTS_FAILED}"
  if (( TESTS_FAILED > 0 )); then
    exit 1
  fi
}

main "$@"
