# Matriks Live BIST Adapter

This test service is prepared for **authorized Matriks Data API / MQTT credentials only**.

It does not scrape public pages, extract embedded JWTs, bypass authentication, or use undocumented credentials.

## Environment variables

- `MATRIKS_MQTT_URL` — official broker URL supplied by Matriks
- `MATRIKS_MQTT_USERNAME` — official username, if required
- `MATRIKS_MQTT_PASSWORD` — official password/token, if required
- `MATRIKS_SUBSCRIPTION_TOPICS` — comma-separated official topic names
- `MATRIKS_TOPIC_TEMPLATE` — alternative topic template containing `{symbol}`
- `SYMBOLS` — e.g. `THYAO,GARAN,ASELS`
- `MATRIKS_MQTT_QOS` — default `0`
- `MATRIKS_REJECT_UNAUTHORIZED` — default `true`

If the broker or topic configuration is missing, the web service stays alive in a
`waiting_for_credentials` / `waiting_for_topic_config` state so Render can be
prepared before Matriks activates the test account.

## Endpoints

- `/` — connection state and latest normalized messages
- `/health` — compact health state

The parser accepts common JSON field names for symbol, last price, volume,
bid/ask and timestamp. Once the official Matriks payload schema is supplied, the
normalizer can be tightened to the exact field names.
