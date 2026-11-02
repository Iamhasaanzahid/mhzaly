# Company Email Setup — `@mhzaly.com` (free, lifetime, add-more-later)

Status check (2026-11-02): **`mhzaly.com` is NOT registered.** Verisign whois returns
`No match for domain "MHZALY.COM"` and public DNS returns `NXDOMAIN`.

That means no email can exist on `@mhzaly.com` until the domain is bought. The
**email service** can be 100% free forever — the **domain** cannot (koi bhi `.com`
lifetime free nahi deta). Domain ~$10–12/saal hai, email $0.

---

## 0. Fast path (automated)

Domain Cloudflare par le liya? Phir bas 3 commands:

```bash
cp scripts/email.env.example .env.email   # token + Zoho values bharo
set -a; . ./.env.email; set +a
DRY_RUN=1 bash scripts/setup_email_dns.sh   # preview
bash scripts/setup_email_dns.sh             # apply
make email-check                            # verify
```

`setup_email_dns.sh` khud TXT-verification, 3 MX, SPF, DKIM, DMARC publish karta hai
aur ghalat MX records clean karta hai (`FORCE=1`). Dobara chalane par duplicate
records nahi bante.

---

## 1. Options (pick one)

| Option | Cost | Real inbox? | Add more later | Verdict |
|---|---|---|---|---|
| **A. `mhzaly.com` + Cloudflare DNS + Zoho Mail Free** | ~$10/yr domain, mail free | ✅ 5 users | 5 tak users + Zoho aliases | **Recommended** |
| **B. `mhzaly.eu.org` (eu.org free domain) + same stack** | $0 forever | ✅ | Same as A | 100% free, approval 2–6 weeks |
| **C. Cloudflare Email Routing only (forward to Gmail)** | $0 | ❌ forward only | 200 rules | Sirf receive; sending alag |
| **D. Free mailbox abhi (Gmail/Zoho personal)** | $0 | ✅ | — | `mhzaly@` nahi milega |

### ⚠️ MX conflict (ye galti mat karna)
Cloudflare Email Routing aur Zoho **ek hi domain par saath nahi chal sakte** —
Email Routing apne MX (`route1.mx.cloudflare.net`) set karta hai, jo Zoho ke MX
replace kar dega aur inbox band ho jayega. Ek domain = ek mail provider.

Agar dono chahiye to **subdomain** use karo: root `mhzaly.com` → Zoho,
`contact.mhzaly.com` → Cloudflare Email Routing. Aliases wahan forward honge.


### Zoho Mail Free plan (2026)
- 5 users, 5 GB each, 1 domain, webmail + iOS/Android app.
- **No IMAP/POP/SMTP** on free — matlab Zoho app/webmail se send/receive chalega,
  lekin Gmail/Outlook me "add account" nahi hoga. Paid plan ($1/user/mo) me SMTP milta hai.
- Users baad me add kar sakte ho (5 tak), har user ka apna mailbox.

### Cloudflare Email Routing (free, unlimited)
- Custom addresses → aapke Gmail me forward (e.g. `support@`, `billing@`, `info@`).
- Receive-only. **Send-as** ke liye free SMTP relay chahiye (Brevo free: 300/day,
  ya Resend free: 100/day) + Gmail "Send mail as".

---

## 2. Recommended path (Option A) — step by step

### Step 1 — Domain buy karo (~$10/yr)
Cheapest at-cost registrars (renewal bhi same rehti hai):

| Registrar | `.com` 1st year | Renewal |
|---|---|---|
| Cloudflare Registrar | ~$10.46 | ~$10.46 (at cost) |
| Porkbun | ~$11.06 | ~$11.06 |
| Namecheap | promo ~$6 | ~$16 |

Cloudflare Registrar sabse saaf hai: no upsell, free WHOIS privacy, free DNS,
aur Email Routing built-in. Buy karte waqt hi nameservers Cloudflare ke set ho jate hain.

### Step 2 — Cloudflare zone add + verify
1. dash.cloudflare.com → **Add a site** → `mhzaly.com` → Free plan.
2. Registrar par jo 2 nameservers diye gaye, wahi set karo.
3. Propagation 5 min – 24 hr (`dig NS mhzaly.com` se check karo).

### Step 3 — Zoho Mail Free signup
1. https://www.zoho.com/mail/zohomail-pricing.html → **Free** → Sign up.
2. Domain `mhzaly.com` daalo → verification method **TXT** chuno.
3. Cloudflare DNS me record add karo:

```
Type: TXT
Name: @
Value: zoho-verification=zbXXXXXXXX.zmverify.zoho.com
TTL: Auto
```

4. Verify → admin mailbox banao, e.g. `mhzaly@mhzaly.com` (ya `admin@`).
5. Zoho ne jo **MX** diye hain, Cloudflare me daalo (proxy **OFF**, DNS-only):

```
MX  @  mx.zoho.com             priority 10
MX  @  mx2.zoho.com            priority 20
MX  @  mx3.zoho.com            priority 50
```

6. Zoho ke SPF/DKIM/DMARC records (Zoho admin → Email Authentication se exact
   values milti hain):

```
TXT  @                    "v=spf1 include:zoho.com ~all"
TXT  zoho._domainkey      "<Zoho DKIM public key>"
TXT  _dmarc               "v=DMARC1; p=none; rua=mailto:dmarc@mhzaly.com"
```

> Cloudflare par TXT value 255 chars se lambi ho to Zoho khud split karke deta hai —
> Cloudflare `TXT` me poora paste karo, wo handle kar leta hai.

7. Test: `dig MX mhzaly.com +short` → Zoho MX dikhne chahiye.
   Phir `bash scripts/check_email_dns.sh mhzaly.com` chalao — sab ✅ hona chahiye.

### Step 4 — Aur addresses add karna (baad me)

**Naya mailbox (naya user, alag inbox):**
Zoho Admin → Users → Add User → `sales@mhzaly.com`. 5 tak free.

**Sirf alias (same inbox, extra address):**
Zoho Admin → Mail Aliases → `billing@`, `noreply@`, `careers@` → `mhzaly@` par deliver.

**Bohat saare public aliases (200 tak, free):**
Root domain par nahi (MX conflict, upar dekho). Subdomain banao:
1. Cloudflare → DNS → add `contact` (ya `mail`) — koi bhi A record, proxy off.
2. Cloudflare → Email → Email Routing → **Enable** → subdomain `contact.mhzaly.com` chuno.
3. Custom addresses: `hello@contact.mhzaly.com`, `press@contact.mhzaly.com` → Zoho/Gmail par forward.
4. Root `mhzaly.com` ka MX Zoho hi rahega — inbox safe.

---

## 3. Option B — bilkul free domain (`mhzaly.eu.org`)

`eu.org` ek volunteer-run free registry hai; domain **permanent free** milta hai.

1. https://nic.eu.org → request `mhzaly.eu.org`, nameservers Cloudflare ke daalo
   (Cloudflare me pehle zone add karke jo NS milte hain).
2. Approval 2–6 weeks (email aata hai). Uske baad zone Cloudflare me active.
3. Phir **Step 3** wahi repeat karo, bas domain `mhzaly.eu.org`.
4. Email address banega `mhzaly@mhzaly.eu.org` — free forever.

Catch: `.com` jaisa brand nahi, aur approval me time lagta hai.

---

## 4. Sending from Gmail (agar Gmail se hi reply karna ho)

Zoho free SMTP nahi deta, is liye free relay use karo:

1. **Brevo** (free 300/day): https://www.brevo.com → SMTP & API → SMTP key lo.
2. Brevo me sender domain `mhzaly.com` verify karo (SPF + DKIM records Cloudflare me).
3. Gmail → Settings → Accounts → **Send mail as** → SMTP:
   - Server: `smtp-relay.brevo.com`, Port `587`, TLS
   - Username: Brevo login, Password: SMTP key
4. Verification email aayega → confirm. Ab Gmail se `mhzaly@mhzaly.com` se send hoga.

---

## 5. Checklist (copy-paste)

```bash
# 1. Domain registered?
bash scripts/check_email_dns.sh mhzaly.com      # or: make email-check

# 2. Nameservers Cloudflare par?
dig NS mhzaly.com +short

# 3. Records publish karo (Cloudflare token + Zoho values ke baad)
set -a; . ./.env.email; set +a
DRY_RUN=1 bash scripts/setup_email_dns.sh       # preview
bash scripts/setup_email_dns.sh                 # apply

# 4. Re-verify
make email-check
```

Full green output ka matlab: mail receive + send + spam protection sab ready hai.

---

## 6. Cost summary

| Item | Cost |
|---|---|
| Domain `.com` (Cloudflare at-cost) | ~$10.46/yr |
| DNS (Cloudflare Free) | $0 |
| Mailboxes (Zoho Free, 5 users) | $0 |
| Aliases (Zoho aliases + Cloudflare subdomain routing) | $0 |
| Sending relay (Brevo free tier) | $0 |
| **Total** | **~$10/yr, baaki lifetime free** |

`mhzaly.eu.org` route lo to total **$0** — bas 2–6 hafte wait.
