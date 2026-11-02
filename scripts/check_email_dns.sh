#!/usr/bin/env bash
# Check whether a domain is ready to send/receive mail.
# Usage: bash scripts/check_email_dns.sh mhzaly.com
set -uo pipefail

DOMAIN="${1:-mhzaly.com}"
PASS=0
FAIL=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

q() { dig +short "$@" 2>/dev/null | grep -v '^$'; }

head "Domain: $DOMAIN"

# 1. Registration
# NOTE: capture output instead of piping into `grep -q`; grep exits early and
# `pipefail` would then report whois's SIGPIPE as a failed pipeline.
if command -v whois >/dev/null 2>&1; then
  WHOIS_OUT="$(whois "$DOMAIN" 2>/dev/null || true)"
  if [[ "$WHOIS_OUT" =~ (No[[:space:]]match|not[[:space:]]found|No[[:space:]]data[[:space:]]found) ]]; then
    bad "Domain NOT registered — buy it first (Cloudflare/Porkbun, ~\$10/yr)."
  elif [[ -z "$WHOIS_OUT" ]]; then
    warn "whois returned nothing (rate limit?) — check registration manually."
  else
    ok "Domain is registered."
  fi
else
  warn "whois not installed — registration check skipped."
fi

# 2. Nameservers
NS=$(q NS "$DOMAIN")
if [[ -n "$NS" ]]; then
  ok "Nameservers: $(echo "$NS" | tr '\n' ' ')"
else
  bad "No NS records — domain has no DNS zone (or not delegated yet)."
fi

# 3. MX
MX=$(q MX "$DOMAIN")
if [[ -n "$MX" ]]; then
  ok "MX records:"
  echo "$MX" | sed 's/^/      /'
  if [[ "${MX,,}" == *zoho* ]]; then
    ok "Provider looks like Zoho Mail."
  fi
else
  bad "No MX records — mail will NOT be received."
fi

# 4. SPF
SPF=$(q TXT "$DOMAIN" | grep -i 'v=spf1')
if [[ -n "$SPF" ]]; then
  COUNT=$(q TXT "$DOMAIN" | grep -ci 'v=spf1')
  if [[ "$COUNT" -gt 1 ]]; then
    bad "Multiple SPF records found ($COUNT) — merge into one."
  else
    ok "SPF: $SPF"
  fi
else
  bad "No SPF record — mail will land in spam."
fi

# 5. DMARC
DMARC=$(q TXT "_dmarc.$DOMAIN")
if [[ -n "$DMARC" ]]; then
  ok "DMARC: $DMARC"
  if [[ "$DMARC" == *"p=none"* ]]; then
    warn "DMARC policy is p=none (monitor only). Move to quarantine/reject later."
  fi
else
  bad "No DMARC record."
fi

# 6. DKIM (common selectors)
head "DKIM selectors"
FOUND_DKIM=0
for sel in zoho zmail google selector1 selector2 default k1 s1 s2 mail dkim; do
  V=$(q TXT "$sel._domainkey.$DOMAIN")
  if [[ -n "$V" ]]; then
    ok "$sel._domainkey found"
    FOUND_DKIM=1
  fi
done
if [[ "$FOUND_DKIM" -eq 0 ]]; then
  bad "No DKIM key found on common selectors — check provider's exact selector."
fi

# 7. Extra hygiene
head "Hygiene"
if [[ -n "$(q TXT "$DOMAIN" | grep -i 'v=DMARC1')" ]]; then
  warn "DMARC TXT on root — should live at _dmarc.$DOMAIN only."
fi
if [[ -n "$(q A "$DOMAIN")" || -n "$(q AAAA "$DOMAIN")" ]]; then
  ok "A/AAAA present (domain also serves a website)."
else
  warn "No A/AAAA — domain is mail-only. Fine, but add a website later if needed."
fi

head "Result"
if [[ "$FAIL" -eq 0 ]]; then
  printf '  \033[32mAll checks passed.\033[0m Mail setup looks healthy.\n'
else
  printf '  \033[31m%d problem(s)\033[0m — see docs/email-setup.md for the exact records.\n' "$FAIL"
fi

exit 0
