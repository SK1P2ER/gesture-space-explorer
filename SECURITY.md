# Security policy

## Supported versions

Only the latest release is supported: the one running at
<https://gesture-space-explorer.vercel.app>, tagged on GitHub. Fixes ship in the
next release. Older versions aren't patched.

## Reporting a vulnerability

Report it privately through GitHub:
**Report a vulnerability**
(the repository's Security tab → *Advisories* → *Report a vulnerability*).
Please don't open a public issue for it.

Say what you found, how to reproduce it (browser, device, the link you opened), and
what someone could do with it. You'll get a reply in the advisory. The aim is to
acknowledge it within 7 days. This is a small project, so a fix can take longer.
You'll be told when it's fixed, and credited in the release notes unless you'd rather
not be.

## In scope

The app's promise is that **the camera image never leaves the device**: hand tracking
runs in the browser, no video is uploaded or stored, and a photo goes only where the
user saves or shares it. Anything that breaks that is in scope, for example:

- the camera staying on, or turning on, when it shouldn't (after the app stops
  tracking, after a failure, after leaving the page, or without the browser's
  permission);
- camera frames, hand landmarks or photos reaching any server, or being stored;
- the app loading code or data from anywhere other than its own site (it serves its
  own hand-tracking model and textures, and makes no third-party requests);
- links that make the app run script or show content it shouldn't (deep links:
  `?body=`, `?base=`, `?date=`, `?lang=`, `?flags=`, `?debug`, `?reset`, and
  AstroLife's souvenir links, `?flags=astrolife#souvenir=…`);
- what it keeps in the browser (`localStorage`: settings, passport, weight, Build
  layouts, AstroLife's bookings) leaking to other sites;
- the deployment's own headers, such as the camera `Permissions-Policy`.

## Out of scope

- Bugs in browsers, three.js or MediaPipe themselves: report those to their
  projects. If one affects this app in a specific way, that part is in scope.
- The hosting platform (Vercel) and GitHub.
- Denial of service, and anything that needs a compromised device or browser.
