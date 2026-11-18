#!/usr/bin/env python3
"""
mhzaly inbox agent — reads Gmail over IMAP and reports what matters.

- Detects replies from contacted leads (Pakistan + international)
- Detects "stop" / unsubscribe requests and adds them to suppression.json
- Detects bounces (mailer-daemon / undelivered)
- Writes automaton-outbox/replies.json + replies-report.md

Credentials are read from ~/.automaton/mhzaly-gmail.env (mode 0600) and are
never printed. Read-only on the mailbox: this script never sends or deletes.

Usage:
  python3 tools/inbox-agent.py
"""
import email
import email.utils
import imaplib
import json
import os
import re
from datetime import datetime, timezone
from email.header import decode_header

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "automaton-outbox")
ENVFILE = os.path.expanduser("~/.automaton/mhzaly-gmail.env")
SENT_FILES = ["gmail-sent.json", "international-sent.json"]
SUPPRESSION = os.path.join(OUT, "suppression.json")
REPORT_JSON = os.path.join(OUT, "replies.json")
REPORT_MD = os.path.join(OUT, "replies-report.md")
MAX_SCAN = int(os.environ.get("INBOX_SCAN", "120"))

STOP_RE = re.compile(r"\b(stop|unsubscribe|remove me|do not (contact|email)|don'?t (contact|email))\b", re.I)
BOUNCE_RE = re.compile(r"(mailer-daemon|postmaster|undelivered|delivery status notification|failure notice)", re.I)


def load_env():
    env = {}
    with open(ENVFILE, encoding="utf-8") as fh:
        for line in fh:
            k, _, v = line.strip().partition("=")
            if k:
                env[k] = v.strip().strip('"')
    return env


def load_set(name):
    try:
        with open(os.path.join(OUT, name), encoding="utf-8") as fh:
            return {str(x).lower().strip() for x in json.load(fh)}
    except Exception:
        return set()


def decode(value):
    try:
        return "".join(
            part.decode(enc or "utf-8", "ignore") if isinstance(part, bytes) else part
            for part, enc in decode_header(value or "")
        )
    except Exception:
        return value or ""


def body_text(msg):
    try:
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    payload = part.get_payload(decode=True) or b""
                    return payload.decode(part.get_content_charset() or "utf-8", "ignore")
            return ""
        payload = msg.get_payload(decode=True) or b""
        return payload.decode(msg.get_content_charset() or "utf-8", "ignore")
    except Exception:
        return ""


def main():
    env = load_env()
    user, password = env.get("GMAIL_USER"), env.get("GMAIL_APP_PASSWORD")
    if not user or not password:
        raise SystemExit("Gmail credentials missing in " + ENVFILE)

    sent = set()
    for name in SENT_FILES:
        sent |= load_set(name)

    try:
        with open(SUPPRESSION, encoding="utf-8") as fh:
            suppression = set(json.load(fh))
    except Exception:
        suppression = set()

    mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    mail.login(user, password)
    mail.select("INBOX", readonly=True)
    _, data = mail.search(None, "ALL")
    ids = data[0].split()[-MAX_SCAN:]

    replies, stops, bounces = [], [], []
    for uid in ids:
        _, fetched = mail.fetch(uid, "(BODY.PEEK[])")
        raw = next((p[1] for p in fetched if isinstance(p, tuple)), b"")
        if not raw:
            continue
        msg = email.message_from_bytes(raw)
        sender = email.utils.parseaddr(decode(msg.get("From", "")))[1].lower()
        subject = decode(msg.get("Subject", ""))
        date = msg.get("Date", "")
        text = body_text(msg)
        blob = f"{subject}\n{text}"

        if BOUNCE_RE.search(sender) or BOUNCE_RE.search(subject):
            original = re.search(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", text, re.I)
            bounces.append({"to": original.group(0) if original else "", "subject": subject[:120]})
            if original:
                suppression.add(original.group(0).lower())
            continue

        if sender in sent:
            entry = {
                "from": sender,
                "subject": subject[:160],
                "date": date,
                "excerpt": re.sub(r"\s+", " ", text)[:300],
            }
            if STOP_RE.search(blob):
                stops.append(entry)
                suppression.add(sender)
            else:
                replies.append(entry)

    mail.logout()

    suppression |= {x.lower() for x in suppression}
    with open(SUPPRESSION, "w", encoding="utf-8") as fh:
        json.dump(sorted(suppression), fh, indent=2)

    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "scanned": len(ids),
        "contacted": len(sent),
        "replies": replies,
        "stops": stops,
        "bounces": bounces,
        "suppressed_total": len(suppression),
    }
    with open(REPORT_JSON, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)

    lines = [
        "# mhzaly — inbox report",
        "",
        f"- Checked: {report['checked_at']}",
        f"- Messages scanned: {report['scanned']}",
        f"- Contacted leads: {report['contacted']}",
        f"- Replies: **{len(replies)}**",
        f"- STOP/unsubscribe: **{len(stops)}**",
        f"- Bounces: **{len(bounces)}**",
        f"- Suppression list total: {len(suppression)}",
        "",
    ]
    if replies:
        lines += ["## Replies", ""]
        for r in replies:
            lines.append(f"- **{r['from']}** — {r['subject']}")
            lines.append(f"  > {r['excerpt'][:220]}")
        lines.append("")
    if stops:
        lines += ["## Unsubscribe requests", ""]
        for s in stops:
            lines.append(f"- {s['from']} — {s['subject']}")
        lines.append("")
    if bounces:
        lines += ["## Bounces", ""]
        for b in bounces:
            lines.append(f"- {b['to'] or '(unknown)'} — {b['subject']}")
        lines.append("")

    with open(REPORT_MD, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    print(json.dumps({
        "scanned": len(ids),
        "contacted": len(sent),
        "replies": len(replies),
        "stops": len(stops),
        "bounces": len(bounces),
        "suppressed": len(suppression),
        "report": "automaton-outbox/replies-report.md",
    }, indent=2))


if __name__ == "__main__":
    main()
