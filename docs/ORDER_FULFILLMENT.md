# Order fulfillment schedule

Fatima Bakery one-time orders support two fulfillment options:

- **Delivery:** Thursday only, 3 PM to 5 PM. Delivery starts from the Santa Rita Ranch area and serves residences within 10 miles in supported Liberty Hill, Leander, and Georgetown areas.
- **Curbside pickup:** Friday only, 9 AM to 12 PM at the Liberty Hill pickup location.
- **Loaf Reserve:** Friday only, 9 AM to 12 PM.
- **Delivery fee:** $10.

The website and Apps Script backend both validate the selected date before an order is accepted. One-time delivery dates must be Thursdays. Pickup and Loaf Reserve dates must be Fridays. Orders continue to close Wednesday at 6 PM before fulfillment.

Square webhook and payment behavior should remain unchanged when schedule copy or validation is updated.
