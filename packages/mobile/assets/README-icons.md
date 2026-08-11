NOTE: App icon source assets are not yet provided.

The following 1024x1024 PNG files are expected at this location:
  - icon-1024.png            — used for both ios.icon and the root "icon" field
  - adaptive-icon-foreground.png — Android adaptive icon foreground layer

These must be generated from the final brand artwork and dropped into this directory
before the first EAS build. Until then, the app.json references will resolve to missing
files at build time (Expo will error if they are absent during `eas build`).
