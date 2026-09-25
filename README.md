# Nyahmation

A desktop studio for making character-animated videos: draw or import a vector character, rig its parts at joints, pose it on the frames that matter, and Nyahmation fills in every frame between. Lip sync uses mouth shapes from a named library. The output is video.

The full requirements and decisions are in [docs/DESIGN.md](docs/DESIGN.md).

## Status

**Phase 0 (foundations) is done:** the animation engine, `.nyah` project files, and a test window that plays a built-in demo puppet. Drawing, rigging and editing tools arrive in phases 1–3.

## Running it

You need [Node.js](https://nodejs.org) 22 LTS or newer.

```sh
npm install      # first time only
npm run dev      # opens the app with live reload
```

In the test window: **Space** plays/pauses, **← / →** step one frame, the slider scrubs, and **Animate on** switches between ones, twos and threes. **Save / Open** write and read `.nyah` files.

## Checks

```sh
npm run check     # type-check + unit tests
npm run test:e2e  # builds the app and drives it with Playwright
```

## Building an installer

Run on the machine for that platform:

```sh
npm run dist:mac  # macOS universal .dmg (Intel + Apple Silicon), in release/
npm run dist:win  # Windows installer, in release/
```

The app isn't signed with an Apple Developer ID, so the first time you open it on a Mac, right-click it and choose **Open**.
