#!/usr/bin/env python3
"""
setup.py — Prepara datos de test para la prueba de carga TicketChain.
Solo usa librería estándar de Python (urllib) — sin dependencias externas.
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone


def parse_args():
    p = argparse.ArgumentParser(
        description="Setup de datos para el stress test TicketChain"
    )
    p.add_argument("--base-url",            default="https://ticketchain404.duckdns.org")
    p.add_argument("--admin-email",         required=True)
    p.add_argument("--admin-password",      required=True)
    p.add_argument("--load-test-email",     required=True)
    p.add_argument("--load-test-password",  required=True)
    p.add_argument("--events",              type=int, default=5)
    p.add_argument("--tickets-per-event",   type=int, default=25000)
    p.add_argument("--output",              default="test-data.json")
    return p.parse_args()


def post(url, payload, token=None, timeout=120):
    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, {}


def login(base_url, email, password):
    status, data = post(f"{base_url}/api/auth/login",
                        {"email": email, "password": password})
    if status != 200:
        raise RuntimeError(f"Login fallido (HTTP {status})")
    return data["token"]


def create_event(base_url, admin_token, name, total_tickets):
    future = (datetime.now(timezone.utc) + timedelta(days=180)).strftime(
        "%Y-%m-%dT20:00:00Z"
    )
    payload = {
        "name":          name,
        "description":   f"Evento de stress test — {name}",
        "date":          future,
        "venue":         "Estadio Stress Test 404",
        "total_tickets": total_tickets,
        "price":         15000,
        "load_test":     True,
        "rules": {
            "precio_max":    200,
            "max_reventas":  99,
            "nominada":      False,
            "ventana_venta": 1,
        },
    }
    status, data = post(f"{base_url}/api/events", payload, token=admin_token)
    if status != 201:
        raise RuntimeError(f"Crear evento fallido (HTTP {status})")
    return data["id"]


def main():
    args = parse_args()
    base = args.base_url.rstrip("/")

    print()
    print("╔══════════════════════════════════════════════════════════╗")
    print("║        TicketChain — Stress Test Setup                  ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"  Base URL:           {base}")
    print(f"  Eventos:            {args.events} × {args.tickets_per_event:,} tickets")
    print(f"  Total tickets:      {args.events * args.tickets_per_event:,}")
    print(f"  Usuario de carga:   {args.load_test_email}")
    print()

    # ── 1. Login admin ────────────────────────────────────────────────────────
    print("▶  [1/4] Login como admin...")
    try:
        admin_token = login(base, args.admin_email, args.admin_password)
        print("   ✓  Admin autenticado\n")
    except Exception as e:
        print(f"   ✗  {e}")
        sys.exit(1)

    # ── 2. Login usuario de carga ─────────────────────────────────────────────
    print("▶  [2/4] Login como usuario de carga...")
    try:
        load_test_token = login(base, args.load_test_email, args.load_test_password)
        print("   ✓  Usuario de carga autenticado\n")
    except Exception as e:
        print(f"   ✗  {e}")
        print("   ¿Está el secret LOAD_TEST_EMAIL/PASSWORD aplicado en el cluster?")
        sys.exit(1)

    # ── 3. Crear eventos ──────────────────────────────────────────────────────
    print(f"▶  [3/4] Creando {args.events} evento(s) con {args.tickets_per_event:,} tickets cada uno...")
    print(f"   (Inicialización en Redis puede tardar ~15s por evento)")
    event_ids = []
    stamp = int(time.time())
    for i in range(1, args.events + 1):
        name = f"StressTest-{i:02d}-{stamp}"
        print(f"   [{i}/{args.events}] '{name}'...", end="", flush=True)
        t0 = time.time()
        try:
            eid = create_event(base, admin_token, name, args.tickets_per_event)
            elapsed = time.time() - t0
            event_ids.append(eid)
            print(f" ✓  ({elapsed:.1f}s) → {eid[:8]}…")
        except Exception as e:
            print(f" ✗  {e}")

    if not event_ids:
        print("\n   ERROR: No se pudo crear ningún evento.")
        sys.exit(1)
    print()

    # ── 4. Guardar test-data.json ─────────────────────────────────────────────
    print(f"▶  [4/4] Guardando {args.output}...")
    data = {
        "base_url":   base,
        "events":     event_ids,
        "token":      load_test_token,
        "user_email": args.load_test_email,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "tickets_per_event": args.tickets_per_event,
            "total_tickets":     len(event_ids) * args.tickets_per_event,
        },
    }
    with open(args.output, "w") as f:
        json.dump(data, f, indent=2)
    print(f"   ✓  Guardado en {args.output}\n")

    print("╔══════════════════════════════════════════════════════════╗")
    print("║  ✅  Setup completo — listo para el stress test          ║")
    print("╠══════════════════════════════════════════════════════════╣")
    print(f"║  Eventos creados:  {str(len(event_ids)).ljust(39)}║")
    print(f"║  Tickets totales:  {str(f'{len(event_ids)*args.tickets_per_event:,}').ljust(39)}║")
    print(f"║  Usuario de carga: {args.load_test_email[:39].ljust(39)}║")
    print("╠══════════════════════════════════════════════════════════╣")
    print("║  Siguiente paso:                                         ║")
    print("║    k6 run stress-test.js                                 ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print()


if __name__ == "__main__":
    main()
