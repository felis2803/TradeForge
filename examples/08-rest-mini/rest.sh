#!/usr/bin/env bash
set -euo pipefail

: "${BASE_URL:=http://localhost:3000}"
: "${SYMBOL:=BTCUSDT}"

json_headers=(-H 'content-type: application/json')

usage() {
  cat <<USAGE
Usage: ${0##*/} <command> [args...]

Commands:
  create_account
  deposit_quote <accountId> <amount> [currency]
  place_limit <accountId> <side> <qty> <price> [symbol]
  place_stop_market <accountId> <side> <qty> <triggerPrice> <triggerDirection> [symbol]
  list_open <accountId> [symbol]
  cancel_by_id <orderId>

Environment:
  BASE_URL (default http://localhost:3000)
  SYMBOL   (default BTCUSDT)
USAGE
}

print_json() {
  local body="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$body" | jq
  else
    printf '%s\n' "$body"
  fi
}

join_url() {
  local path="$1"
  if [[ "$path" == /* ]]; then
    printf '%s%s' "${BASE_URL%/}" "$path"
  else
    printf '%s/%s' "${BASE_URL%/}" "$path"
  fi
}

extract_json_field() {
  local body="$1"
  local jq_filter="$2"
  local label="$3"
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required to parse ${label}" >&2
    return 1
  fi
  local value
  if ! value=$(printf '%s\n' "$body" | jq -e -r "$jq_filter" 2>/dev/null); then
    echo "${label} missing in response" >&2
    printf '%s\n' "$body" >&2
    return 1
  fi
  if [[ -z "$value" ]]; then
    echo "${label} empty in response" >&2
    printf '%s\n' "$body" >&2
    return 1
  fi
  printf '%s' "$value"
}

create_account() {
  local response
  response=$(curl -sfS -X POST "$(join_url '/v1/accounts')" \
    "${json_headers[@]}" -d '{}')
  local account_id
  account_id=$(extract_json_field "$response" '.id' 'account id') || {
    echo 'create_account failed: unexpected response' >&2
    return 1
  }
  if [[ -z "$account_id" ]]; then
    echo 'create_account failed: empty id' >&2
    return 1
  fi
  print_json "$response"
}

deposit_quote() {
  if [[ $# -lt 2 ]]; then
    echo "usage: deposit_quote <accountId> <amount> [currency]" >&2
    return 1
  fi
  local account_id="$1"
  local amount="$2"
  local currency="${3:-USDT}"
  local payload
  printf -v payload '{"currency":"%s","amount":"%s"}' "$currency" "$amount"
  local response
  response=$(curl -sfS -X POST "$(join_url "/v1/accounts/${account_id}/deposit")" \
    "${json_headers[@]}" \
    -d "$payload")
  print_json "$response"
}

place_limit() {
  if [[ $# -lt 4 ]]; then
    echo "usage: place_limit <accountId> <side> <qty> <price> [symbol]" >&2
    return 1
  fi
  local account_id="$1"
  local side="${2^^}"
  local qty="$3"
  local price="$4"
  local symbol="${5:-$SYMBOL}"
  local payload
  printf -v payload '{"accountId":"%s","symbol":"%s","type":"LIMIT","side":"%s","qty":"%s","price":"%s"}' \
    "$account_id" "$symbol" "$side" "$qty" "$price"
  local response
  response=$(curl -sfS -X POST "$(join_url '/v1/orders')" \
    "${json_headers[@]}" \
    -d "$payload")
  local order_id
  order_id=$(extract_json_field "$response" '.id // .orderId' 'order id') || {
    echo 'place_limit failed: unexpected response' >&2
    return 1
  }
  if [[ -z "$order_id" ]]; then
    echo 'place_limit failed: empty order id' >&2
    return 1
  fi
  print_json "$response"
}

place_stop_market() {
  if [[ $# -lt 5 ]]; then
    echo "usage: place_stop_market <accountId> <side> <qty> <triggerPrice> <triggerDirection> [symbol]" >&2
    return 1
  fi
  local account_id="$1"
  local side="${2^^}"
  local qty="$3"
  local trigger_price="$4"
  local trigger_direction="${5^^}"
  local symbol="${6:-$SYMBOL}"
  local payload
  printf -v payload '{"accountId":"%s","symbol":"%s","type":"STOP_MARKET","side":"%s","qty":"%s","triggerPrice":"%s","triggerDirection":"%s"}' \
    "$account_id" "$symbol" "$side" "$qty" "$trigger_price" "$trigger_direction"
  local response
  response=$(curl -sfS -X POST "$(join_url '/v1/orders')" \
    "${json_headers[@]}" \
    -d "$payload")
  local order_id
  order_id=$(extract_json_field "$response" '.id // .orderId' 'order id') || {
    echo 'place_stop_market failed: unexpected response' >&2
    return 1
  }
  if [[ -z "$order_id" ]]; then
    echo 'place_stop_market failed: empty order id' >&2
    return 1
  fi
  print_json "$response"
}

list_open() {
  if [[ $# -lt 1 ]]; then
    echo "usage: list_open <accountId> [symbol]" >&2
    return 1
  fi
  local account_id="$1"
  local symbol="${2:-$SYMBOL}"
  local url
  printf -v url '%s' "$(join_url "/v1/orders/open?accountId=${account_id}&symbol=${symbol}")"
  local response
  response=$(curl -sfS "$url")
  print_json "$response"
}

cancel_by_id() {
  if [[ $# -lt 1 ]]; then
    echo "usage: cancel_by_id <orderId>" >&2
    return 1
  fi
  local order_id="$1"
  local response
  response=$(curl -sfS -X DELETE "$(join_url "/v1/orders/${order_id}")")
  print_json "$response"
}

if [[ $# -eq 0 || "$1" == 'help' || "$1" == '--help' ]]; then
  usage
  exit 0
fi

command="$1"
shift

case "$command" in
  create_account)
    create_account "$@"
    ;;
  deposit_quote)
    deposit_quote "$@"
    ;;
  place_limit)
    place_limit "$@"
    ;;
  place_stop_market)
    place_stop_market "$@"
    ;;
  list_open)
    list_open "$@"
    ;;
  cancel_by_id)
    cancel_by_id "$@"
    ;;
  *)
    echo "unknown command: $command" >&2
    usage
    exit 1
    ;;
esac
