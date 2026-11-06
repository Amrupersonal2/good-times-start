# Clean up preview console errors

## What the screenshots show
Most red lines come from the Lovable editor itself, not from Restro POS. That includes "RS SDK", Facebook/HubSpot/Reddit/Spotify Pixel, the `[perf]` marks, "Unrecognized feature", iframe sandbox warnings and "Permissions policy violation: unload". The software can't change these, and they don't affect the counter.

Only one error belongs to the software:
- `manifest-pos.webmanifest` failed with 401. The preview sits behind the Lovable sign-in, and the browser fetches the install file without sending that sign-in, so the preview refuses it. On the published site this error doesn't happen.

The preview frame was also still on the loading logo when the screenshot was taken. I'll check whether the Customers page finishes loading.

## Steps
1. Make the install-file link send the sign-in, so the preview stops returning 401. The published site works the same as before.
2. Open the Customers page signed in, wait for it to load, and record any errors that come from the software. Fix anything real that turns up there, such as a page stuck on the logo.
3. Confirm the console shows no software errors. The editor's own lines will still be there.

## Technical details
- `src/components/AppInstall.tsx`: add `crossOrigin="use-credentials"` to `<link rel="manifest" ...>`.
- Verify with signed-in Playwright on `/customers`, capturing `pageerror` and console errors that come from app bundles only.
