# Advanced Security — Explained Simply

Citadel has 4 extra security tools on top of the normal login checks. This
page explains what each one does and how it works, in plain English — no
computer-science background needed.

All 4 tools live behind one place in the code: `POST /api/security/evaluate`.
Each one checks something different. If any one of them finds something
suspicious, the risk score for that login goes up. If a tool is turned off or
not working, it just stays quiet — it never blocks anyone by being missing.

---

## 🔐 PQC Shield — protection against future quantum computers

**The problem it solves:** Today's internet security (the locks that protect
your data while it travels) can theoretically be broken by a powerful enough
quantum computer. Such computers don't fully exist yet, but a hacker could
record your encrypted traffic *today* and unlock it *years from now* once
quantum computers are good enough. This is called "harvest now, decrypt
later."

**How Citadel protects against it:** It uses two official (US government
approved, called "NIST") quantum-safe methods instead of, or alongside, the
usual ones:

- **ML-KEM-768** — this is how your browser and the server agree on a secret
  password for the session. Both sides end up with the exact same secret
  number, but they never actually send that secret over the network — so
  nobody watching the traffic can ever see it, now or in the future.
- **Dilithium-3** — this is used to "sign" every security decision, like a
  tamper-proof wax seal. If anyone tries to alter the decision after it was
  made, the seal breaks and it's obvious.

Both of these are quantum-resistant, meaning even a future quantum computer
can't crack them.

---

## 🪤 Deception — traps for bots and hackers

**The idea:** Set traps that only a bot or an attacker would ever step on,
never a real customer.

There are two kinds of traps:

1. **An invisible form field.** On the login page there's a form field that
   is completely invisible — no human ever sees it or clicks into it. But
   bots and auto-filling scripts often "fill in every box they can find,"
   including invisible ones. If that field gets filled in, Citadel knows for
   certain it wasn't a real person.
2. **Fake decoy web addresses.** Citadel has a few web addresses that sound
   juicy to a hacker, like `/api/admin/export_users` or `/.env` (a common
   place hackers look for secret passwords). No real app or real customer
   would ever visit these. If anyone visits one, that's 100% a hacker probing
   around.

**What happens when a trap is triggered:** That visitor's internet address
(IP) gets blocked for 24 hours, the fraud team is alerted instantly on their
live dashboard, and that login attempt is immediately blocked as high risk.

---

## 🌀 Anti-Spoofing — catching fake or copied requests

This tool checks two different things:

- **Copy-and-replay protection (this one is very solid, not a guess).**
  Every time you try to log in, the server hands you a one-time-use code
  (like a raffle ticket that can only be used once). Your browser has to
  prove it has that exact code by doing a small bit of math with a secret key
  only it and the server know. If someone records your login attempt and
  tries to replay it later, it fails immediately — because that one-time code
  has already been "spent." It's a strict yes/no check.

- **Hand-shake / tremor detection (this one is an educated guess, not
  proof).** When a real person moves a mouse or touches a screen, their hand
  has tiny, involuntary shakes — a natural human "wobble." A robot script
  that fakes mouse movement usually moves in a way that is too smooth and
  perfect. Citadel looks at the pattern of movement and checks if it looks
  "wobbly like a human" or "too smooth like a script." This check is honest
  about its limits — it's a helpful hint, never used by itself to block
  someone, and if there isn't enough movement data to judge, it just stays
  neutral instead of guessing.

---

## 🧮 zk-SNARK Passport — proving something without showing it

This is the most advanced one, and also the coolest to explain simply.

**The problem:** Imagine you want to prove to a bank "I am who I say I am,
AND my behavior looks safe" — but you don't want to hand over your actual
private fingerprint data or your exact risk score, because that's sensitive
information you don't want floating around or getting leaked.

**The trick — a "zero-knowledge proof":** This lets your device create a
mathematical proof that says:

> "I know a secret that matches my enrolled identity, AND my risk score is
> below the safe limit"

...without ever revealing what the secret actually is, or what the exact
risk score actually was. The bank's server can check the proof and be 100%
sure it's true, while learning nothing else.

**How it actually happens, step by step:**

1. The first time you use the app on your device, your browser secretly
   generates a random private key and saves it only on your device. This
   never gets sent anywhere.
2. Your browser also creates a fingerprint of your recent behavior (how you
   typed, moved the mouse, etc).
3. Your browser combines these two into one "baseline" number using a special
   one-way math function (so nobody can work backwards from it to find your
   secret).
4. When you log in, your browser builds a proof (this all happens locally, in
   the browser itself) that says "my secret + behavior baseline matches what
   was enrolled, and my current risk score is under the limit" — without
   revealing the actual secret or the actual score.
5. The server checks the proof using pure math (no trust involved, no
   "take my word for it") and either accepts or rejects it.

**Why this is useful:** In the future, this could let two different banks
trust each other's "this customer is behaving normally" signal without either
bank ever having to share the customer's actual private biometric data with
the other. Trust without oversharing.

---

## How they all work together

Every one of these 4 tools reports a risk number from 0 (totally fine) to
1000 (definitely block). Citadel takes the **highest** number reported by any
tool, and that becomes the "security score" for that login. This security
score is then compared against the separate AI behavioral risk score (the one
that checks how you type and move) — and again, **whichever score is
higher wins**. That final number decides: let the customer in normally, ask
for extra verification, or block the account and alert the fraud team.

The whole design follows one rule: **a tool that is switched off or not
working should never be the reason someone gets blocked** — it just quietly
does nothing, and every other tool keeps working as normal.
