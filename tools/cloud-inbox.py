#!/usr/bin/env python3
"""Cloud inbox checker for mhzaly outreach.

Runs in GitHub Actions, so STOP/unsubscribe replies and bounces are recorded
even when the laptop is off. Uses Gmail IMAP with the owner's app password.
"""
import email
import imaplib
import json
import os
import re
import sys
import urllib.request
from email.utils import parseaddr

USER = os.environ.get("GMAIL_USER", "")
PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
API = os.environ.get("MHZALY_API_URL", "https://mhzaly-api.mhzaly.workers.dev").rstrip("/")
KEY = os.environ.get("MHZALY_API_KEY", "")

if not (USER and PASSWORD and KEY):
    sys.exit("GMAIL_USER, GMAIL_APP_PASSWORD and MHZALY_API_KEY are required")


def set_status(address: str, status: str) -> None:
    payload = json.dumps({"email": address, "status": status}).encode()
    req = urllib.request.Request(
        API + "/api/automaton/outreach/status",
        method="POST",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Api-Key": KEY,
            "User-Agent": "mhzaly-automaton/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        res.read()


def body_text(msg) -> str:
    chunks = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disposition = str(part.get("Content-Disposition", ""))
            if "attachment" in disposition:
                continue
            if ctype in ("text/plain", "text/html"):
                try:
                    raw = part.get_payload(decode=True) or b""
                    text = raw.decode(part.get_content_charset() or "utf-8", "ignore")
                    if ctype == "text/html":
                        text = re.sub(r"<[^>]+>", " ", text)
                    chunks.append(text)
                except Exception:
                    continue
    else:
        try:
            raw = msg.get_payload(decode=True) or b""
            chunks.append(raw.decode(msg.get_content_charset() or "utf-8", "ignore"))
        except Exception:
            pass
    return "\n".join(chunks)


def is_stop(subject: str, body: str) -> bool:
    low = (subject + "\n" + body).lower()
    if re.search(r"\bunsubscribe\b|\bremove me\b|\bband karo\b|\bnahi chahiye\b|نہیں چاہیے", low):
        return True
    return bool(re.search(r"^\s*stop\s*$", low, re.MULTILINE))


def is_bounce(sender: str, subject: str) -> bool:
    low = (sender + " " + subject).lower()
    return any(
        token in low
        for token in (
            "mailer-daemon",
            "postmaster",
            "delivery status notification",
            "undelivered mail",
            "mail delivery failed",
            "failure notice",
        )
    )


def main() -> None:
    client = imaplib.IMAP4_SSL("imap.gmail.com", 993, timeout=30)
    client.login(USER, PASSWORD)
    client.select("INBOX")
    typ, data = client.search(None, "UNSEEN")
    ids = data[0].split()[-60:] if typ == "OK" and data and data[0] else []

    stops = []
    bounces = []
    for msg_id in ids:
        typ, fetched = client.fetch(msg_id, "(RFC822)")
        if typ != "OK" or not fetched or not fetched[0]:
            continue
        msg = email.message_from_bytes(fetched[0][1])
        sender = parseaddr(msg.get("From", ""))[1].lower()
        subject = str(msg.get("Subject", ""))
        body = body_text(msg)[:200000]

        if is_bounce(sender, subject):
            for found in set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", body)):
                found = found.lower().strip(".")
                if found != USER.lower() and "mailer-daemon" not in found:
                    try:
                        set_status(found, "bounce")
                        bounces.append(found)
                    except Exception:
                        pass
        elif sender and sender != USER.lower() and is_stop(subject, body):
            try:
                set_status(sender, "stop")
                stops.append(sender)
            except Exception:
                pass

        try:
            client.store(msg_id, "+FLAGS", "\\Seen")
        except Exception:
            pass

    client.logout()
    def mask(address: str) -> str:
        user, _, domain = address.partition("@")
        return (user[:1] or "*") + "***@" + domain


    print(json.dumps({
        "scanned": len(ids),
        "stops": [mask(x) for x in stops],
        "bounces": [mask(x) for x in bounces],
    }, indent=2))


if __name__ == "__main__":
    main()
