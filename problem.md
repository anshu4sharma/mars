 

MARS COSMETICS · ENGINEERING 

Assessment 

Order & Inventory Sync Service 

1. Overview 

You will design a service that keeps orders and stock in sync across four sales channels, and explain your trade-offs in a short written design doc. The problem is small enough to finish in one sitting, but it contains a real concurrency problem. How you handle it matters more than anything else. 

Item 

Details 

Time box 

3–4 hours. Please do not spend more. 

Deadline 

3 days from receiving this brief 

Deliverable 

DESIGN.md plus one architecture diagram, in a GitHub repo 

Code 

Not required. Optional pseudo-code for the stock reservation logic only. 

AI tools 

Allowed. Note where you used them. You must be able to defend every decision on the follow-up call. 

2. Problem statement 

A D2C beauty brand sells about 1,200 SKUs on four channels: its own website, Nykaa, Flipkart and Blinkit. All stock ships from one central warehouse. Today each channel’s stock is updated by hand from a spreadsheet twice a day. During the last sale the brand oversold about 900 units and had to cancel those orders, which hurt its seller rating on two marketplaces. 

Design an Order & Inventory Sync Service that: 

Collects orders from all four channels into one place. 

Keeps the stock shown on each channel close to the real stock in the warehouse. 

Pushes every confirmed order to the company’s ERP (Microsoft Business Central), which handles invoicing and dispatch. 

How each channel behaves 

Channel 

Getting orders 

Updating stock 

Limits and quirks 

Own website 

Webhook on order created or cancelled 

Direct DB / API (we own it) 

None 

Nykaa 

Webhook. May be sent twice or out of order. 

REST API, one SKU per call 

5 requests/sec 

Flipkart 

Polling only, every 2 min at the fastest 

Bulk API, up to 50 SKUs per call 

10 requests/sec; returns 429 when exceeded 

Blinkit 

Webhook 

Daily CSV upload, plus a REST API for urgent changes 

API is unreliable: about 2% of calls time out 

ERP (Business Central) 

— 

Receives orders via API 

Down for 1–2 hours most Sundays for maintenance 

 

You do not need real API access. This is a design exercise. The limits above are hypothetical and may not match the real Nykaa, Flipkart or Blinkit APIs. Treat the table as the API contract and design against it. Don’t sign up for seller APIs or call any real endpoint. If the brief doesn’t cover something (auth method, payload fields), make a reasonable assumption and list it in your Assumptions section. 

Volume 

Normal day: about 8,000 orders. 

Sale day: 10× normal, peaking at about 300 orders per minute in the first hour. 

About 6% of orders are cancelled or returned, and that stock must go back on sale. 

Sample order event 

Every channel sends a different shape. After you convert them, an incoming order looks roughly like this. You may change it. 

{ 

  "channel": "NYKAA", 

  "external_order_id": "NYK-20261023-884213", 

  "event": "ORDER_CREATED", 

  "event_time": "2026-10-23T11:04:52+05:30", 

  "items": [ 

    { "sku": "MRS-LIP-104", "qty": 2, "unit_price": 349.00 }, 

    { "sku": "MRS-KJL-011", "qty": 1, "unit_price": 199.00 } 

  ], 

  "payment_mode": "PREPAID", 

  "shipping_pincode": "110034", 

  "total_amount": 897.00 

} 

3. Requirements 

Functional 

Bring in orders from all four channels and convert them into one common order format. 

Reserve stock the moment an order arrives, from any channel. 

Update the stock shown on every channel within 60 seconds of a change (normal load). 

Put stock back when an order is cancelled or returned. 

Send every confirmed order to the ERP exactly once. 

Give the ops team a screen that lists failed syncs and lets them retry each one. 

Non-functional 

No overselling. On a sale day, no more than 0.5% of orders may be cancelled for lack of stock. 

Isolation. If one channel or the ERP is down, the other channels keep working. 

No lost orders. An order received while the ERP is down for 2 hours must reach the ERP once it is back. 

Peak load. Handle 300 orders per minute without a manual scale-up. 

Audit trail. For any SKU, ops must be able to answer: “why did stock change, and when?” 

Constraints 

Stack: Node.js / NestJS, PostgreSQL, Redis, AWS. Any other component needs a written justification. 

Team: 3 developers. v1 has to ship in 6 weeks. 

Infra budget: about ₹50,000 per month. Be careful with managed services you can’t justify. 

Questions to answer in your doc 

Architecture. Draw a diagram of the components and how data flows between them. Say what runs where. 

Data model. List the main tables, their key columns and constraints, and say how you avoid duplicate orders. 

Order ingestion. How do you handle webhooks and polling, duplicate or out-of-order events, and a channel that is down? 

Inventory consistency. Two channels sell the last unit of a SKU in the same second. Walk through exactly what happens in your design. 

Stock push. How do you update four channels with different rate limits within 60 seconds during a sale? 

Failure handling. Cover retries, the ERP’s Sunday downtime, Blinkit timeouts, and messages that keep failing. 

Observability. List the 3–5 metrics or alerts you would set up on day one. 

Scope. Name what you would deliberately leave out of v1, and why. 

Stretch (optional; pick one) 

A. Add a second warehouse in Bengaluru. What changes in your design? 

B. Add an LLM feature that lets ops ask “why did SKU X oversell yesterday?” in plain English. What data does it read, how do you stop it making things up, and what does it cost? 

4. What to submit 

Submit a public GitHub repo, or a /design folder in your existing take-home repo, containing: 

DESIGN.md, at most 4 pages of content. Longer is not better. 

One architecture diagram. Mermaid, Excalidraw or draw.io exported as PNG are all fine. 

An Assumptions section listing everything you assumed where the brief was silent. 

A trade-offs table with at least 3 decisions. For each one, give what you chose, what you rejected, and why. 

An AI usage note (one line): which tools you used, and for what. 

Optional: pseudo-code for the stock reservation step (question 4). 

We will discuss your design on a 20–30 minute call. Expect to explain any part of it and adjust it live when we change the requirements. 

Good luck. We care more about clear reasoning than a perfect design. 