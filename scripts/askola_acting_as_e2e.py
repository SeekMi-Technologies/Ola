#!/usr/bin/env python3
"""Cross-account askola E2E for X-Acting-As user-data isolation (Phase ISO).

Logs into two test accounts, drives /api/ola/chat for query + create flows,
parses the SSE stream, and verifies via direct DB lookup that every doc
created lands under the logged-in admin's namespace (createdBy match).

Pre-flight:
  - bash start-dev.sh up (backend 8888, mcp 8889, nanobot serve 8900)
  - nanobot serve must be running NEW pool code (Phase ISO Fix 2). If you
    haven't restarted nanobot since pulling the new MCPClientPool, restart
    first or this script measures the old broken state.

Env required:
  DATABASE          mongo connection string (read from backend/.env normally)
  BACKEND_URL       default http://localhost:8888

Usage:
  source backend/.env  # exports DATABASE
  /path/to/python scripts/askola_acting_as_e2e.py

Test data created with prefix `ZYD-E2E-{run_id}-*` is intentionally NOT
deleted by this script — review then run scripts/cleanup_zyd_e2e_data.js.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field

import requests
from pymongo import MongoClient


BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8888")
DATABASE = os.environ.get("DATABASE")
if not DATABASE:
    sys.stderr.write(
        "ERROR: DATABASE env var not set. Run `source backend/.env` first.\n"
    )
    sys.exit(2)

# expected_admin_id is resolved at runtime from the DB by `email` (see
# preflight) so this script keeps working when the DB is reset or runs
# against a different environment without manual ID rewriting.
ACCOUNTS: list[dict] = [
    {
        "email": "admin@admin.com",
        "password": "admin123",
        "label": "admin",
        "owns_serial": "A-1492",
        "owns_prefix": "A-",
        "lacks_serial": "BMW-100143",
        "lacks_prefix": "BMW-",
    },
    {
        "email": "yuz371@ucsd.edu",
        "password": "12345678",
        "label": "yuz371",
        "owns_serial": "BMW-100143",
        "owns_prefix": "BMW-",
        "lacks_serial": "A-1492",
        "lacks_prefix": "A-",
    },
]


def resolve_admin_ids() -> None:
    """Populate ACCOUNTS[i]['expected_admin_id'] from the DB by email.
    Aborts loudly if any account is missing — would otherwise produce silent
    createdBy mismatches downstream."""
    db = db_client()
    for acc in ACCOUNTS:
        a = db["admins"].find_one({"email": acc["email"], "removed": False})
        if not a:
            sys.stderr.write(
                f"ERROR: no admin in DB with email {acc['email']!r}. "
                f"Seed the account or update ACCOUNTS in this script.\n"
            )
            sys.exit(2)
        acc["expected_admin_id"] = str(a["_id"])


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


@dataclass
class Result:
    passes: int = 0
    fails: int = 0
    details: list[str] = field(default_factory=list)


def green(s: str) -> str:
    return f"\033[32m{s}\033[0m"


def red(s: str) -> str:
    return f"\033[31m{s}\033[0m"


def yellow(s: str) -> str:
    return f"\033[33m{s}\033[0m"


def assert_(result: Result, label: str, ok: bool, detail: str = "") -> None:
    if ok:
        result.passes += 1
        print(f"  {green('[PASS]')} {label}")
    else:
        result.fails += 1
        msg = f"  {red('[FAIL]')} {label}"
        if detail:
            msg += f"\n         {detail}"
        print(msg)
        result.details.append(f"{label}  {detail}")


# ---------------------------------------------------------------------------
# HTTP / SSE
# ---------------------------------------------------------------------------


def login(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(
        f"{BACKEND}/api/login",
        json={"email": email, "password": password},
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"login {email} failed HTTP {r.status_code}: {r.text[:200]}")
    if "token" not in s.cookies:
        raise RuntimeError(
            f"login {email} did not set cookie. response={r.text[:200]}"
        )
    return s


def parse_sse_stream(raw_text: str) -> tuple[list[dict], list[dict]]:
    """Returns (thinking_steps, blocks_from_done_event)."""
    thinking: list[dict] = []
    blocks: list[dict] = []
    for frame in raw_text.split("\n\n"):
        frame = frame.strip()
        if not frame:
            continue
        event_name = "message"
        data_lines: list[str] = []
        for line in frame.split("\n"):
            if line.startswith("event:"):
                event_name = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:") :].strip())
        data = "\n".join(data_lines)
        if not data or data == "[DONE]":
            continue
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            continue
        if event_name == "thinking_step":
            thinking.append(payload)
        elif event_name == "done":
            blocks = payload.get("blocks", [])
    return thinking, blocks


def chat(session: requests.Session, message: str, timeout: int = 90) -> tuple[
    list[dict], list[dict], str
]:
    r = session.post(
        f"{BACKEND}/api/ola/chat",
        json={"message": message},
        timeout=timeout,
        stream=False,
    )
    if r.status_code != 200:
        raise RuntimeError(f"/api/ola/chat HTTP {r.status_code}: {r.text[:300]}")
    # SSE response is utf-8 but content-type may omit charset → requests
    # auto-detects to ISO-8859-1, garbling Chinese. Decode bytes manually.
    body = r.content.decode("utf-8", errors="replace")
    thinking, blocks = parse_sse_stream(body)
    text = "".join(b.get("content", "") for b in blocks if b.get("type") == "text")
    return thinking, blocks, text


# Pattern groups for "not found" — agent may reply in Chinese 未找到 / 没找到
# / 没有找到 or English "no match found / not found / could not find".
NOT_FOUND_RE = re.compile(
    r"(未找到|没找到|没有找到|未查到|没有查到|"
    r"no match|not found|could not find|no record|"
    r"没有.*?记录|不存在)",
    re.IGNORECASE,
)


def is_not_found_reply(text: str, serial: str) -> bool:
    """Robust 'agent said it could not find serial' detector."""
    if NOT_FOUND_RE.search(text):
        return True
    # Defensive: if the SKU is not even mentioned, treat as not-found-by-omission.
    return serial not in text


# ---------------------------------------------------------------------------
# DB checks
# ---------------------------------------------------------------------------


def db_client():
    return MongoClient(DATABASE, tls=True, tlsAllowInvalidCertificates=True)[
        DATABASE.rsplit("/", 1)[-1].split("?")[0]
    ]


def find_one(coll: str, query: dict) -> dict | None:
    return db_client()[coll].find_one(query)


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------


def case_query_my_products(account: dict, session: requests.Session, result: Result):
    # Isolation property under test: when listing my products, the reply must
    # contain ZERO SNs from the OTHER admin's prefix. Whether the agent
    # actually lists own-prefix SNs is a separate prompt/quality issue (LLM
    # sometimes replies "no records" even when DB has plenty); not an
    # isolation failure.
    label = f"[{account['label']}] '我有什么产品' returns no foreign-prefix SNs"
    _, _, text = chat(session, "我有什么产品？请列出 5 个我名下的产品序列号")
    own = re.findall(re.escape(account["owns_prefix"]) + r"[\w\-]+", text)
    foreign = re.findall(re.escape(account["lacks_prefix"]) + r"[\w\-]+", text)
    ok = len(foreign) == 0
    detail = f"own-prefix matches: {own!r}; foreign-prefix matches: {foreign!r}"
    if ok and not own:
        detail += " — note: agent did not list own SNs (LLM variance, not isolation)"
    assert_(result, label, ok, detail + f"; text head: {text[:200]!r}")


def case_query_owned_serial(account: dict, session: requests.Session, result: Result):
    label = f"[{account['label']}] '查询 {account['owns_serial']}' → 找到"
    _, _, text = chat(session, f"查询 {account['owns_serial']}")
    found = (
        not is_not_found_reply(text, account["owns_serial"])
        and account["owns_serial"] in text
    )
    assert_(result, label, found, f"text: {text[:200]!r}")


def case_query_other_admin_serial(
    account: dict, session: requests.Session, result: Result
):
    label = (
        f"[{account['label']}] '查询 {account['lacks_serial']}' → not found "
        f"(belongs to other admin)"
    )
    _, _, text = chat(session, f"查询 {account['lacks_serial']}")
    ok = is_not_found_reply(text, account["lacks_serial"])
    assert_(
        result,
        label,
        ok,
        f"text: {text[:200]!r}  (this serial is in another admin's namespace; "
        f"if agent returns its details here, isolation broke)",
    )


def case_create_customer(
    account: dict, session: requests.Session, result: Result, run_id: str
) -> str | None:
    """Asks the agent to create a customer; returns the created customer's
    name string for caller bookkeeping (or None on failure)."""
    name = f"ZYD-E2E-{run_id}-CUST-{account['label']}"
    prompt = (
        f"创建客户 {name}, 联系人 ZYD Test, 国家 US, 邮箱 zyde2e@example.com"
    )
    _, _, text = chat(session, prompt, timeout=120)
    # Allow agent some slack — give it 3s to settle DB write
    time.sleep(3)
    doc = find_one("clients", {"name": name})
    if doc is None:
        assert_(
            result,
            f"[{account['label']}] customer.create '{name}' persisted",
            False,
            f"agent reply: {text[:300]!r}; DB did not contain {name}",
        )
        return None
    expected = account["expected_admin_id"]
    actual = str(doc.get("createdBy"))
    assert_(
        result,
        f"[{account['label']}] customer.create '{name}' createdBy == {expected}",
        actual == expected,
        f"actual createdBy={actual}  expected={expected}  doc._id={doc.get('_id')}",
    )
    return name


def case_create_merch(
    account: dict, session: requests.Session, result: Result, run_id: str
) -> str | None:
    serial = f"ZYD-E2E-{run_id}-MERCH-{account['label']}"
    prompt = (
        f"创建 merchandise 序列号 {serial}, 长序列号 {serial}-LONG, "
        f"英文描述 ZYD E2E test merch, 中文描述 测试用商品, "
        f"单位 PCS, 中文单位 个, 重量 1, VAT 13, ETR 0"
    )
    _, _, text = chat(session, prompt, timeout=120)
    time.sleep(3)
    doc = find_one("merches", {"serialNumber": serial})
    if doc is None:
        # Mongo collection name might be 'merch' instead of 'merches' depending
        # on Mongoose pluralization rules. Fall back.
        doc = find_one("merch", {"serialNumber": serial})
    if doc is None:
        assert_(
            result,
            f"[{account['label']}] merch.create '{serial}' persisted",
            False,
            f"agent reply: {text[:300]!r}; DB did not contain {serial}",
        )
        return None
    expected = account["expected_admin_id"]
    actual = str(doc.get("createdBy"))
    assert_(
        result,
        f"[{account['label']}] merch.create '{serial}' createdBy == {expected}",
        actual == expected,
        f"actual createdBy={actual}  expected={expected}  doc._id={doc.get('_id')}",
    )
    return serial


# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------


def preflight() -> None:
    print("Pre-flight checks:")
    try:
        r = requests.get(f"{BACKEND}/health", timeout=3)
        ok = r.status_code == 200
    except Exception as e:
        ok = False
    if not ok:
        print(f"  {red('[FAIL]')} backend {BACKEND}/health unreachable")
        sys.exit(2)
    print(f"  {green('[OK]')} backend {BACKEND}/health 200")

    # MCP fail-closed sanity (Fix 1 must be live):
    try:
        r = requests.post(
            f"http://127.0.0.1:8889/mcp",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "customer.create", "arguments": {}},
            },
            timeout=3,
        )
        # No Authorization → 401 from auth middleware (good — server reachable)
        if r.status_code != 401:
            print(
                f"  {yellow('[WARN]')} MCP /mcp returned {r.status_code} "
                "(expected 401 for unauth) — auth middleware may be misconfigured"
            )
        else:
            print(f"  {green('[OK]')} MCP server up + auth gate active")
    except Exception as e:
        print(f"  {yellow('[WARN]')} MCP probe failed: {e}")

    print(f"  {green('[OK]')} DATABASE env set ({DATABASE.split('@', 1)[-1][:30]}...)")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    run_id = str(int(time.time()))
    print(f"Phase ISO askola E2E — run_id={run_id}")
    print(f"Test data prefix: ZYD-E2E-{run_id}-*  (NOT auto-deleted)\n")

    preflight()
    resolve_admin_ids()
    print(
        "Resolved admin ids:\n"
        + "\n".join(f"  {a['email']:30} → {a['expected_admin_id']}" for a in ACCOUNTS)
        + "\n"
    )

    result = Result()
    created: list[tuple[str, str]] = []  # (collection, identifier) for cleanup audit

    for account in ACCOUNTS:
        print(f"\n=== Account: {account['email']} (expected {account['expected_admin_id']}) ===")
        try:
            session = login(account["email"], account["password"])
        except Exception as e:
            print(f"  {red('[FAIL]')} login: {e}")
            result.fails += 1
            continue
        print(f"  {green('[OK]')} login\n")

        try:
            case_query_my_products(account, session, result)
        except Exception as e:
            print(f"  {red('[FAIL]')} case_query_my_products raised: {e}")
            result.fails += 1
        try:
            case_query_owned_serial(account, session, result)
        except Exception as e:
            print(f"  {red('[FAIL]')} case_query_owned_serial raised: {e}")
            result.fails += 1
        try:
            case_query_other_admin_serial(account, session, result)
        except Exception as e:
            print(f"  {red('[FAIL]')} case_query_other_admin_serial raised: {e}")
            result.fails += 1
        try:
            cust_name = case_create_customer(account, session, result, run_id)
            if cust_name:
                created.append(("clients", cust_name))
        except Exception as e:
            print(f"  {red('[FAIL]')} case_create_customer raised: {e}")
            result.fails += 1
        try:
            merch_sn = case_create_merch(account, session, result, run_id)
            if merch_sn:
                created.append(("merch", merch_sn))
        except Exception as e:
            print(f"  {red('[FAIL]')} case_create_merch raised: {e}")
            result.fails += 1

    print(f"\n{'='*60}")
    print(f"Summary: {green(str(result.passes) + ' PASS')} / {red(str(result.fails) + ' FAIL')}")
    if result.fails:
        for line in result.details:
            print(f"  - {line}")
    if created:
        print(f"\nCreated test data (preserved for review):")
        for coll, ident in created:
            print(f"  {coll:12s} {ident}")
        print(
            f"\nWhen ready to clean up, run:\n"
            f"  cd backend && node scripts/cleanup_zyd_e2e_data.js {run_id}"
        )

    return 1 if result.fails else 0


if __name__ == "__main__":
    sys.exit(main())
