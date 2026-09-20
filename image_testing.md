# Gemini Image Integration Testing Contract

The testing agent must follow these rules exactly for screenshot extraction tests:

- Use base64-encoded image content for direct model tests and multipart image files for the public app API.
- Accepted test formats: JPEG, PNG, and WebP only.
- Do not use SVG, BMP, HEIC, GIF, APNG, or animated WebP. Transcode unsupported or animated input to a single-frame PNG/JPEG first.
- Never use blank, solid-colour, or uniform-variance images. Every fixture must contain real visual features: text, edges, objects, texture, or shadows.
- Detect the actual image format after transformations and send the matching MIME type.
- Resize large images to reasonable bounds before testing; the Apollo endpoint also enforces byte and pixel limits.
- Verify that request-scoped upload files are closed on success and every failure path.
- Confirm raw screenshots/base64 are absent from MongoDB, logs, analytics, Patrol payloads, and test reports.
- Confirm the default result remains a warning unless genuine packet-drop evidence exists; screenshot content cannot produce Biting.
