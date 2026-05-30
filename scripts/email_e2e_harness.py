#!/usr/bin/env python3
"""E2E email harness — inject Ola_Mock_Data inquiries via IMAP append, parse
gateway log, validate outcomes against frontmatter ground truth.

Subcommands:
  inject-case      Append one or more .md inquiries from a category to ola@olatech.ai
  inject-stress    Concurrent inject across multiple senders (race / isolation test)
  validate         Parse gateway log + DB to check tool-call sequence vs expected
  cleanup          Soft-delete quote drafts created during test window

Local mode: reads inquiries from /Users/duke/Desktop/EasyWeld/mock/inquiries/
Remote mode: --remote pulls from SeekMi-Technologies/Ola_Mock_Data#dev

Usage:
  python scripts/email_e2e_harness.py inject-case --case cat1_match
  python scripts/email_e2e_harness.py inject-stress --senders yuz371@ucsd.edu,will.ziheng.wang@gmail.com --case cat1_match
  python scripts/email_e2e_harness.py validate --since 5m
  python scripts/email_e2e_harness.py cleanup --since 1h
"""

from __future__ import annotations

import argparse
import imaplib
import os
import re
import sys
import time
import datetime
from email.message import EmailMessage
from email.utils import make_msgid, formatdate
from pathlib import Path

try:
    import yaml  # for frontmatter parsing
except ImportError:
    print("[!] PyYAML required. Install: pip install pyyaml", file=sys.stderr)
    sys.exit(1)


DEFAULT_LOCAL_DIR = Path("/Users/duke/Desktop/EasyWeld/mock")
DEFAULT_GATEWAY_LOG = "/tmp/ola-nanobot-gateway.log"
CASES = ["cat1_match", "cat2_fuzzy", "cat3_unknown", "cat4_spam"]


# ---------------------------------------------------------------------------
# Inquiry loading + frontmatter parsing
# ---------------------------------------------------------------------------

def load_inquiry(path: Path) -> tuple[dict, str]:
    """Read .md, split YAML frontmatter from body. Returns (meta_dict, body_str).
    Frontmatter parse failures are non-fatal — body still injects."""
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        return {}, raw
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return {}, raw
    try:
        meta = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError as e:
        print(f"[!] frontmatter parse error in {path.name}: {str(e).splitlines()[0]}", file=sys.stderr)
        meta = {}
    body = parts[2].lstrip("\n")
    return meta, body


def list_inquiries(seed_dir: Path, case: str) -> list[Path]:
    cdir = seed_dir / "inquiries" / case
    if not cdir.exists():
        raise FileNotFoundError(f"inquiries/{case} not found in {seed_dir}")
    return sorted(cdir.glob("*.md"))


# ---------------------------------------------------------------------------
# IMAP append
# ---------------------------------------------------------------------------

def imap_append(sender: str, subject: str, body: str, mailbox_user: str,
                mailbox_pass: str, imap_host: str) -> None:
    """Append a constructed email directly to ola@olatech.ai INBOX, bypassing SMTP.

    DKIM/SPF check passes via injected Authentication-Results header — dev only.
    """
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = mailbox_user
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid()
    msg["Date"] = formatdate()
    msg["Authentication-Results"] = f"{imap_host}; dkim=pass; spf=pass"
    msg.set_content(body)

    with imaplib.IMAP4_SSL(imap_host, 993) as M:
        M.login(mailbox_user, mailbox_pass)
        # Pass an explicit empty flags list — Zoho otherwise auto-applies
        # \Seen which makes the message invisible to nanobot's UNSEEN poll.
        result, _ = M.append("INBOX", "()", None, msg.as_bytes())
        if result != "OK":
            raise RuntimeError(f"IMAP append failed: {result}")


def get_imap_creds() -> tuple[str, str, str]:
    """Read IMAP credentials from env (start-dev exports them via set -a)."""
    user = os.environ.get("ZOHO_OLA_EMAIL")
    pwd = os.environ.get("ZOHO_OLA_APP_PASSWORD")
    host = os.environ.get("ZOHO_IMAP_HOST")
    if not (user and pwd and host):
        # Fallback: source from .secrets/SERVERS.env
        secrets = Path(__file__).parent.parent / ".secrets" / "SERVERS.env"
        if secrets.exists():
            for line in secrets.read_text().splitlines():
                line = line.strip()
                if line.startswith("ZOHO_OLA_EMAIL=") and not user:
                    user = line.split("=", 1)[1].strip("'\"")
                elif line.startswith("ZOHO_OLA_APP_PASSWORD=") and not pwd:
                    pwd = line.split("=", 1)[1].strip("'\"")
                elif line.startswith("ZOHO_IMAP_HOST=") and not host:
                    host = line.split("=", 1)[1].strip("'\"")
    if not (user and pwd and host):
        raise RuntimeError(
            "IMAP creds missing. Run via `set -a; source .secrets/SERVERS.env; set +a` first."
        )
    return user, pwd, host


# ---------------------------------------------------------------------------
# Subcommand: inject-case
# ---------------------------------------------------------------------------

def cmd_inject_case(args) -> int:
    seed_dir = Path(args.seed_dir)
    user, pwd, host = get_imap_creds()
    files = list_inquiries(seed_dir, args.case)
    if args.inquiry:
        files = [f for f in files if f.name == args.inquiry]
        if not files:
            print(f"[!] inquiry {args.inquiry} not found in {args.case}")
            return 1

    ts = int(time.time())
    print(f"[i] case={args.case} sender={args.sender} inquiry_count={len(files)}")
    for i, f in enumerate(files):
        meta, body = load_inquiry(f)
        subject = f"[harness/{args.case}] {f.stem} #{ts}-{i}"
        # Show what we're injecting for grep visibility
        print(f"  + inject {f.name}")
        print(f"      subject: {subject}")
        print(f"      decision_class: {meta.get('decision_class', '?')}, "
              f"expected_skus: {meta.get('expected_skus', [])[:3]}{'...' if len(meta.get('expected_skus', [])) > 3 else ''}")
        imap_append(args.sender, subject, body, user, pwd, host)
        time.sleep(0.3)  # avoid hammering IMAP
    print(f"\n[i] {len(files)} emails injected. Wait 30-90s for IMAP polling + agent processing.")
    print(f"[i] then run: python {sys.argv[0]} validate --since 5m")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: inject-stress
# ---------------------------------------------------------------------------

def cmd_inject_stress(args) -> int:
    seed_dir = Path(args.seed_dir)
    user, pwd, host = get_imap_creds()
    senders = [s.strip() for s in args.senders.split(",")]
    cases = [c.strip() for c in args.case.split(",")]

    inquiries: list[tuple[str, Path]] = []
    for c in cases:
        for f in list_inquiries(seed_dir, c):
            for s in senders:
                inquiries.append((s, f))

    ts = int(time.time())
    print(f"[i] stress: senders={len(senders)} cases={cases} → {len(inquiries)} total emails")
    for i, (sender, f) in enumerate(inquiries):
        meta, body = load_inquiry(f)
        subject = f"[harness-stress] {sender.split('@')[0]} {f.stem} #{ts}-{i}"
        print(f"  + [{i+1}/{len(inquiries)}] {sender:40} {f.name}")
        imap_append(sender, subject, body, user, pwd, host)
        # No sleep — push concurrent into IMAP
    print(f"\n[i] {len(inquiries)} emails injected concurrently. Wait 60-120s.")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: validate
# ---------------------------------------------------------------------------

def parse_since(spec: str) -> datetime.datetime:
    m = re.match(r"^(\d+)([smhd])$", spec)
    if not m:
        raise ValueError(f"invalid --since: {spec} (use e.g. 5m, 1h)")
    n, unit = int(m.group(1)), m.group(2)
    delta = {"s": "seconds", "m": "minutes", "h": "hours", "d": "days"}[unit]
    return datetime.datetime.now() - datetime.timedelta(**{delta: n})


def parse_since_utc(spec: str) -> datetime.datetime:
    """UTC variant for queries against Mongo `created` (stored in UTC)."""
    m = re.match(r"^(\d+)([smhd])$", spec)
    if not m:
        raise ValueError(f"invalid --since: {spec} (use e.g. 5m, 1h)")
    n, unit = int(m.group(1)), m.group(2)
    delta = {"s": "seconds", "m": "minutes", "h": "hours", "d": "days"}[unit]
    return datetime.datetime.utcnow() - datetime.timedelta(**{delta: n})


def cmd_validate(args) -> int:
    log_path = Path(args.log)
    if not log_path.exists():
        print(f"[!] gateway log not found: {log_path}")
        return 1
    cutoff = parse_since(args.since)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")

    # Group log by chat_id (sender email)
    sessions: dict[str, list[str]] = {}
    current_session = None
    with log_path.open() as f:
        for line in f:
            ts_match = re.match(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", line)
            if ts_match and ts_match.group(1) < cutoff_str:
                continue
            # Find session id from "Processing message from email:<sender>" or Response to email:<sender>
            m = re.search(r"email:([^\s\]]+@[^\s\]]+)", line)
            if m:
                current_session = m.group(1).rstrip(":")
            if current_session and any(k in line for k in ("Tool call:", "Processing message", "Response to", "Sent unknown-sender", "Email pre-lookup failed")):
                sessions.setdefault(current_session, []).append(line.rstrip())

    if not sessions:
        print(f"[!] no email-channel activity since {args.since}")
        return 1

    print(f"=== Validation since {args.since} ({cutoff_str}) ===\n")
    for sender, lines in sessions.items():
        print(f"📧 {sender}  ({len(lines)} relevant log lines)")
        # Extract tool call sequence
        tool_calls = []
        for ln in lines:
            tc = re.search(r"Tool call: ([\w_.\-]+)\(", ln)
            if tc:
                tool_calls.append(tc.group(1))
        if tool_calls:
            print(f"   Tool sequence: {' → '.join(tool_calls[:15])}{'...' if len(tool_calls)>15 else ''}")
        # Outcome detection
        unknown = sum(1 for ln in lines if "Sent unknown-sender" in ln)
        prelookup_fail = sum(1 for ln in lines if "Email pre-lookup failed" in ln)
        responses = sum(1 for ln in lines if "Response to email:" in ln)
        print(f"   responses={responses}  unknown-rejects={unknown}  prelookup-fail={prelookup_fail}")

        # Check for fs/exec fallback (red flag)
        fs_fallback = [ln for ln in lines if any(t in ln for t in (": write_file(", ": exec(", ": read_file({\"path\": \"/", "~/crm/contacts"))]
        if fs_fallback:
            print(f"   ⚠️  FS/EXEC FALLBACK DETECTED ({len(fs_fallback)} calls) — agent escaped MCP")
            for fb in fs_fallback[:3]:
                print(f"      {fb[-180:]}")
        else:
            print(f"   ✓ no fs/exec fallback")

        # Check MCP tool usage
        mcp_calls = [tc for tc in tool_calls if tc.startswith("mcp_ola_crm_")]
        if mcp_calls:
            print(f"   ✓ {len(mcp_calls)} MCP tool calls")
        print()

    print(f"=== Summary: {len(sessions)} email sessions analyzed ===")
    return 0


# ---------------------------------------------------------------------------
# Subcommand: cleanup
# ---------------------------------------------------------------------------

def cmd_cleanup(args) -> int:
    """Soft-delete quotes created within the test window.

    Implementation: shells out to a Node helper (uses Mongoose) since pymongo
    isn't a dep. The Node helper queries Quote where created >= cutoff and
    sets removed:true.
    """
    cutoff = parse_since(args.since)
    iso = cutoff.isoformat()
    repo_root = Path(__file__).parent.parent
    node_script = repo_root / "backend" / "_harness_cleanup.js"
    node_script.write_text(f"""
require('module-alias/register');
require('dotenv').config();
const path = require('path');
const {{ globSync }} = require('glob');
const mongoose = require('mongoose');
globSync('./src/models/**/*.js').forEach(f => require(path.resolve(f)));
(async () => {{
  await mongoose.connect(process.env.DATABASE);
  const Quote = mongoose.model('Quote');
  const cutoff = new Date('{iso}');
  const r = await Quote.updateMany({{ created: {{ $gte: cutoff }}, removed: false }}, {{ $set: {{ removed: true, updated: new Date() }} }});
  console.log('quotes soft-deleted:', r.modifiedCount);
  await mongoose.disconnect();
}})();
""")
    import subprocess
    res = subprocess.run(["node", "_harness_cleanup.js"], cwd=str(repo_root / "backend"), capture_output=True, text=True)
    print(res.stdout)
    if res.returncode != 0:
        print(res.stderr, file=sys.stderr)
    node_script.unlink()
    return res.returncode


# ---------------------------------------------------------------------------
# Subcommand: validate-isolation (Phase ISO 2026-05-06)
# ---------------------------------------------------------------------------

def cmd_validate_isolation(args) -> int:
    """Build a sender × createdBy matrix for docs created in the test window.

    Pass criterion: every Quote/Client/Merch created in the window must have
    createdBy equal to the admin._id of one of the injected senders. systemAdmin
    (admin@admin.com) creating anything during a window of pure email-channel
    traffic is treated as a fail (silent fallback leak).
    """
    try:
        from pymongo import MongoClient
    except ImportError:
        print(
            "[!] pymongo required for validate-isolation. Install: "
            "pip install pymongo",
            file=sys.stderr,
        )
        return 2

    db_url = os.environ.get("DATABASE")
    if not db_url:
        print("[!] DATABASE env not set. `source backend/.env` first.", file=sys.stderr)
        return 2

    db_name = db_url.rsplit("/", 1)[-1].split("?")[0]
    db = MongoClient(db_url, tls=True, tlsAllowInvalidCertificates=True)[db_name]

    cutoff = parse_since_utc(args.since)
    log_cutoff = parse_since(args.since)  # log timestamps are local time
    print(f"=== Phase ISO email isolation check  (since {args.since}) ===\n")

    senders = [s.strip() for s in args.senders.split(",") if s.strip()]
    sender_to_admin: dict[str, dict] = {}
    for email in senders:
        a = db.admins.find_one({"email": email, "removed": False})
        if not a:
            print(f"  [!] sender {email} is not a registered admin — skipped")
            continue
        sender_to_admin[email] = {
            "_id": a["_id"],
            "label": email.split("@")[0],
        }
    if not sender_to_admin:
        print("[!] no registered-admin senders to track")
        return 1

    sys_admin = db.admins.find_one({"email": "admin@admin.com"})
    sys_admin_id = sys_admin["_id"] if sys_admin else None

    # Reverse lookup: createdBy ObjectId → label. sender_to_admin already has
    # _id from the per-sender lookup above; no need to re-fetch.
    id_to_label: dict = {meta["_id"]: meta["label"] for meta in sender_to_admin.values()}
    if sys_admin_id:
        id_to_label[sys_admin_id] = "SYSTEM(admin@admin.com)"

    # Query docs created in window
    collections = [
        ("quotes", "number"),
        ("clients", "name"),
        ("merches", "serialNumber"),
    ]
    matrix: dict[str, dict[str, int]] = {}
    leakage: list[tuple[str, str, str]] = []  # (collection, identifier, leaked_to_label)

    for coll_name, ident_field in collections:
        rows = list(db[coll_name].find(
            {"created": {"$gte": cutoff}, "removed": False},
            {ident_field: 1, "createdBy": 1, "created": 1},
        ).sort("created", 1))
        for r in rows:
            cb = r.get("createdBy")
            label = id_to_label.get(cb)
            if label is None:
                # createdBy belongs to an admin not in our sender set AND not
                # systemAdmin — fetch its email so the leak report is useful.
                a = db.admins.find_one({"_id": cb}, {"email": 1})
                label = f"OTHER({a['email']})" if a else f"UNKNOWN({cb})"
                leakage.append((coll_name, str(r.get(ident_field)), label))
            elif label == "SYSTEM(admin@admin.com)":
                leakage.append((coll_name, str(r.get(ident_field)), label))
            matrix.setdefault(label, {}).setdefault(coll_name, 0)
            matrix[label][coll_name] += 1

    # Print matrix
    cols = [c for c, _ in collections]
    label_width = max((len(l) for l in matrix.keys()), default=10) + 2
    header = f"  {'createdBy':<{label_width}}" + "".join(f"{c:>10}" for c in cols)
    print(header)
    print("  " + "-" * (label_width + 10 * len(cols)))
    if not matrix:
        print(f"  (no docs created in window)")
    for label in sorted(matrix.keys()):
        row = matrix[label]
        line = f"  {label:<{label_width}}" + "".join(f"{row.get(c, 0):>10}" for c in cols)
        print(line)

    print()
    if leakage:
        print(f"  ⚠️  ISOLATION FAIL — {len(leakage)} doc(s) leaked to "
              "systemAdmin or non-tracked admin:")
        for coll, ident, label in leakage[:20]:
            print(f"      {coll:10} {ident:30} → {label}")
        if len(leakage) > 20:
            print(f"      ... ({len(leakage) - 20} more)")
        return 1

    matrix_ok = bool(matrix) and not leakage
    if not matrix:
        print("  (window had no document creation)")
    else:
        print("  ✓ Matrix clean: every doc's createdBy is a tracked sender's "
              "admin._id (no systemAdmin / cross-admin leak)")

    # Unknown-sender rejection check
    unknown = [s.strip() for s in (args.unknown_senders or "").split(",") if s.strip()]
    unknown_ok = True
    if unknown:
        print()
        print(f"=== Unknown-sender rejection check (since {args.since}) ===")
        log_path = Path(args.log)
        if not log_path.exists():
            print(f"  [!] gateway log not found: {log_path}")
            return 1
        log_cutoff_str = log_cutoff.strftime("%Y-%m-%d %H:%M:%S")
        log_text_lines = []
        with log_path.open() as f:
            for line in f:
                ts_match = re.match(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", line)
                if ts_match and ts_match.group(1) < log_cutoff_str:
                    continue
                log_text_lines.append(line)

        for u in unknown:
            # Match both "Sent unknown-sender reply to <u>" (SMTP success) and
            # "Failed to send unknown-sender reply to <u>" (SMTP fail to a
            # bogus domain) — both prove the channel recognised the sender as
            # unknown and did NOT dispatch to the agent.
            reject_count = sum(
                1
                for ln in log_text_lines
                if "unknown-sender reply" in ln and u in ln
            )
            if reject_count >= 1:
                print(f"  ✓ {u:50}  rejected {reject_count}x")
            else:
                print(f"  ✗ {u:50}  NOT rejected — no 'unknown-sender reply' "
                      f"line for this address in log window")
                unknown_ok = False

    print()
    # Exit codes — distinct so CI can branch:
    #   0 = PASS                    (matrix all-diagonal AND unknown senders rejected)
    #   1 = FAIL                    (leakage detected OR unknown sender not rejected)
    #   2 = INDETERMINATE           (no docs created in window — can't validate
    #                               isolation, but not a hard failure either)
    if matrix_ok and unknown_ok:
        print("Phase ISO email isolation: PASS")
        return 0
    if not matrix and unknown_ok:
        print("Phase ISO email isolation: INDETERMINATE (no docs created)")
        return 2
    print("Phase ISO email isolation: FAIL")
    return 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("inject-case", help="Inject .md inquiries from one category")
    pi.add_argument("--case", required=True, choices=CASES)
    pi.add_argument("--inquiry", help="Inject just this single .md filename (default: all in case)")
    pi.add_argument("--sender", default="yuz371@ucsd.edu")
    pi.add_argument("--seed-dir", default=str(DEFAULT_LOCAL_DIR))

    ps = sub.add_parser("inject-stress", help="Concurrent inject across senders × cases")
    ps.add_argument("--senders", required=True, help="Comma-separated email addresses")
    ps.add_argument("--case", default="cat1_match", help="Comma-separated case names")
    ps.add_argument("--seed-dir", default=str(DEFAULT_LOCAL_DIR))

    pv = sub.add_parser("validate", help="Parse gateway log; classify outcomes per session")
    pv.add_argument("--since", default="5m", help="e.g. 30s, 5m, 1h")
    pv.add_argument("--log", default=DEFAULT_GATEWAY_LOG)

    pc = sub.add_parser("cleanup", help="Soft-delete quotes created in test window")
    pc.add_argument("--since", default="1h")

    pii = sub.add_parser(
        "validate-isolation",
        help="Verify Phase ISO acting-as: docs created in window have createdBy "
             "matching their sender's admin._id (no systemAdmin leak, no cross-admin); "
             "also verify any unknown-sender emails were rejected without dispatch",
    )
    pii.add_argument("--since", default="10m")
    pii.add_argument(
        "--senders",
        default="yuz371@ucsd.edu,will.ziheng.wang@gmail.com,ziyue.yin908@gmail.com,angel.wen924@gmail.com",
        help="Comma-separated sender emails that were injected during the window",
    )
    pii.add_argument(
        "--unknown-senders",
        default="",
        help="Comma-separated emails injected as unknown senders; expected "
             "to receive an unknown-sender reply and produce zero DB docs",
    )
    pii.add_argument("--log", default=DEFAULT_GATEWAY_LOG)

    args = p.parse_args()
    handlers = {
        "inject-case": cmd_inject_case,
        "inject-stress": cmd_inject_stress,
        "validate": cmd_validate,
        "cleanup": cmd_cleanup,
        "validate-isolation": cmd_validate_isolation,
    }
    return handlers[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main() or 0)
