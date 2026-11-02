#!/usr/bin/env bash
# Provision the DNS records needed for company mail (Zoho Mail Free) on a
# Cloudflare-managed domain. Idempotent: safe to run repeatedly.
#
#   cp scripts/email.env.example .env.email   # fill in the values
#   set -a; . ./.env.email; set +a
#   bash scripts/setup_email_dns.sh            # DRY_RUN=1 to preview
#
# Requires: curl, jq. Needs a Cloudflare API token with Zone.DNS:Edit.
set -euo pipefail

API="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"
DOMAIN="${MAIL_DOMAIN:-mhzaly.com}"
DRY_RUN="${DRY_RUN:-0}"
FORCE="${FORCE:-0}"

MX_HOSTS=("mx.zoho.com:10" "mx2.zoho.com:20" "mx3.zoho.com:50")

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
skip(){ printf '  \033[36m=\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }
step(){ printf '\n\033[1m%s\033[0m\n' "$*"; }

[[ -n "${CF_API_TOKEN:-}" ]] || die "CF_API_TOKEN is not set (create one: My Profile > API Tokens > Edit zone DNS)."
command -v jq >/dev/null || die "jq is required."
[[ -n "${ZOHO_VERIFY:-}" ]] || warn "ZOHO_VERIFY not set — domain verification record will be skipped."
[[ -n "${ZOHO_DKIM:-}"   ]] || warn "ZOHO_DKIM not set — DKIM record will be skipped (mail still works, spam score worse)."

# ---------------------------------------------------------------- Cloudflare --
cf() { # method path [json]
  local method=$1 path=$2 body=${3:-}
  local args=(-sS -X "$method" "$API$path"
              -H "Authorization: Bearer $CF_API_TOKEN"
              -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}"
}

cf_ok() {
  local resp=$1
  if [[ "$(jq -r '.success // false' <<<"$resp")" != "true" ]]; then
    jq -r '.errors[]? | "  \(.code): \(.message)"' <<<"$resp" >&2
    die "Cloudflare API call failed."
  fi
}

step "Zone: $DOMAIN"
ZONE_ID="${CF_ZONE_ID:-}"
if [[ -z "$ZONE_ID" ]]; then
  resp=$(cf GET "/zones?name=$DOMAIN")
  cf_ok "$resp"
  ZONE_ID=$(jq -r '.result[0].id // empty' <<<"$resp")
  [[ -n "$ZONE_ID" ]] || die "Zone '$DOMAIN' not found in this account. Add the site to Cloudflare first."
fi
ok "zone id $ZONE_ID"

list_records() { # type
  local resp; resp=$(cf GET "/zones/$ZONE_ID/dns_records?type=$1&per_page=100")
  cf_ok "$resp"
  printf '%s' "$resp"
}

find_id() { # type fqdn mode(prefix|exact) value
  list_records "$1" | jq -r --arg n "$2" --arg m "$3" --arg v "$4" '
    .result[]
    | select(.name == $n)
    | select(
        (.content | rtrimstr(".")) as $c
        | ($v | rtrimstr(".")) as $want
        | if $m == "prefix" then ($c | startswith($want)) else $c == $want end
      )
    | .id' | sed -n '1p'
}

write_record() { # method path payload description
  local method=$1 path=$2 payload=$3 desc=$4
  if [[ "$DRY_RUN" == "1" ]]; then
    skip "[dry-run] would $method $desc"
    return 0
  fi
  local resp; resp=$(cf "$method" "$path" "$payload")
  cf_ok "$resp"
  ok "$desc"
}

upsert() { # type fqdn mode match_value payload desc
  local type=$1 name=$2 mode=$3 value=$4 payload=$5 desc=$6
  local id; id=$(find_id "$type" "$name" "$mode" "$value")
  if [[ -n "$id" ]]; then
    local current; current=$(list_records "$type" | jq -r --arg i "$id" '.result[] | select(.id==$i) | [.content, (.priority // 0)] | @tsv')
    local wanted; wanted=$(jq -r '[.content, (.priority // 0)] | @tsv' <<<"$payload")
    if [[ "$current" == "$wanted" ]]; then
      skip "$desc (already correct)"
      return 0
    fi
    write_record PUT "/zones/$ZONE_ID/dns_records/$id" "$payload" "$desc (updated)"
  else
    write_record POST "/zones/$ZONE_ID/dns_records" "$payload" "$desc (created)"
  fi
}

# ------------------------------------------------------------------ Records ---
step "Mail records"

if [[ -n "${ZOHO_VERIFY:-}" ]]; then
  upsert TXT "$DOMAIN" prefix "zoho-verification=" \
    "$(jq -nc --arg n "$DOMAIN" --arg c "$ZOHO_VERIFY" \
        '{type:"TXT",name:$n,content:$c,ttl:1}')" \
    "TXT @ zoho-verification"
fi

for entry in "${MX_HOSTS[@]}"; do
  host=${entry%:*}; prio=${entry#*:}
  upsert MX "$DOMAIN" exact "$host" \
    "$(jq -nc --arg n "$DOMAIN" --arg c "$host" --argjson p "$prio" \
        '{type:"MX",name:$n,content:$c,priority:$p,ttl:1}')" \
    "MX @ $host (priority $prio)"
done

upsert TXT "$DOMAIN" prefix "v=spf1" \
  "$(jq -nc --arg n "$DOMAIN" '{type:"TXT",name:$n,content:"v=spf1 include:zoho.com ~all",ttl:1}')" \
  "TXT @ SPF"

if [[ -n "${ZOHO_DKIM:-}" ]]; then
  upsert TXT "zoho._domainkey.$DOMAIN" exact "$ZOHO_DKIM" \
    "$(jq -nc --arg n "zoho._domainkey.$DOMAIN" --arg c "$ZOHO_DKIM" \
        '{type:"TXT",name:$n,content:$c,ttl:1}')" \
    "TXT zoho._domainkey DKIM"
fi

DMARC_POLICY="${DMARC_POLICY:-none}"
DMARC_RUA="${DMARC_RUA:-mailto:dmarc@$DOMAIN}"
upsert TXT "_dmarc.$DOMAIN" prefix "v=DMARC1" \
  "$(jq -nc --arg n "_dmarc.$DOMAIN" --arg c "v=DMARC1; p=$DMARC_POLICY; rua=$DMARC_RUA; adkim=r; aspf=r" \
      '{type:"TXT",name:$n,content:$c,ttl:1}')" \
  "TXT _dmarc (p=$DMARC_POLICY)"

# ------------------------------------------------------------- Cleanup MXes ---
step "Conflicting MX records"
stale=$(list_records MX | jq -r --arg n "$DOMAIN" --argjson keep '["mx.zoho.com","mx2.zoho.com","mx3.zoho.com"]' '
  .result[] | select(.type == "MX") | select(.name == $n)
  | select((.content | rtrimstr(".")) as $c | $keep | index($c) | not)
  | "\(.id) \(.content)"')

if [[ -z "$stale" ]]; then
  ok "none"
else
  while read -r id content; do
    [[ -z "$id" ]] && continue
    if [[ "$FORCE" == "1" && "$DRY_RUN" != "1" ]]; then
      cf DELETE "/zones/$ZONE_ID/dns_records/$id" >/dev/null
      ok "deleted stale MX $content"
    else
      warn "stale MX $content (id $id) — rerun with FORCE=1 to delete"
    fi
  done <<<"$stale"
fi

# ------------------------------------------------------------------- Verify ---
step "Verification"
if [[ "$DRY_RUN" == "1" ]]; then
  warn "dry run — skipping DNS verification"
  exit 0
fi
warn "DNS propagation can take a few minutes. Current state:"
bash "$(dirname "$0")/check_email_dns.sh" "$DOMAIN" || true

step "Next"
cat <<EOF
  1. Zoho admin > Domains > verify (record is already published).
  2. Create the first mailbox, e.g. mhzaly@$DOMAIN.
  3. Add more users later: Zoho admin > Users > Add User (5 free).
  4. Re-check any time: bash scripts/check_email_dns.sh $DOMAIN
EOF
