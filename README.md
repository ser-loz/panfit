# 🍳 PanFit

Plan frying before you start cooking. Photograph the cut food on a cutting board or
plate; PanFit measures every piece and tells you whether the batch fits your pan in
one go, needs two rounds, or is best split across two pans.

A zero-dependency progressive web app: plain HTML, CSS, and JavaScript. No framework,
no build step, no backend. All processing happens on the device — no data ever
leaves it.

## Using the app

Open the app URL in your phone's browser once, then choose **Add to Home screen**
(Chrome: ⋮ menu). It installs like a regular app and works fully offline afterwards.

A measurement session takes under a minute:

1. Spread the cut food on a cutting board or plate — single layer, pieces not
   touching each other.
2. Choose the board shape and enter its size: width × height for a rectangular
   board, diameter for a round board or plate (remembered for next time).
3. Take a photo from roughly above.
4. Tap four reference points on the photo: the corners of a rectangular board, or
   the top/right/bottom/left rim points of a round one.
5. Review the highlighted pieces. The sensitivity slider adjusts detection; tapping
   a piece includes or excludes it.
6. Read the verdict: your saved pans and pan pairs, ranked by fewest frying rounds.

Pans (name + diameter) are saved on the device, so they are entered only once.

## Hosting

The app is static files; any HTTPS static host serves it as-is — there is nothing
to build.

- **GitHub Pages** — enable once in the repository settings (**Settings → Pages →
  Deploy from a branch → `main`, `/ (root)`**); every push then republishes the
  app at `https://<username>.github.io/<repository>/`.
- **Anywhere else** — copy `index.html`, `style.css`, `app.js`, `sw.js`,
  `manifest.webmanifest`, and `icons/` to any web root.

For local development, run any static server from the repository root, e.g.:

```
python -m http.server 8317
```

Offline caching only activates over HTTPS, so local development always serves
fresh files.

## Architecture

| File | Role |
|---|---|
| `index.html` | The four screens: photo → reference points → review → verdict |
| `app.js` | All logic (~500 lines): geometry, detection, verdict |
| `style.css` | Dark, mobile-first styling |
| `sw.js` | Service worker: network-first cache for offline use |
| `manifest.webmanifest` | Home-screen installation metadata |

The measurement pipeline in `app.js`:

1. **Rectify** — the four tapped points define a homography (an 8×8 linear system
   solved by Gaussian elimination) that warps the photo into a top-down view of the
   board at a known px/cm scale, cancelling the perspective distortion of shooting
   at an angle. For a round board the same 4-point math applies: a circle of
   diameter *d* inscribes in a *d* × *d* square, touching it at the four side
   midpoints, and tangency survives projective transformation — so the tapped rim
   extremes serve as the correspondence points and everything downstream is
   unchanged.
2. **Detect** — the board's colour is estimated as the per-channel median of a thin
   band where food rarely sits (the border of a rectangular board, an annulus just
   inside a round rim). Pixels far from that colour in RGB distance count as food;
   the sensitivity slider is that distance threshold. In round mode, pixels outside
   the plate are ignored entirely. Connected components (flood fill) split the mask
   into pieces; blobs under 0.35 cm² are dropped as noise.
3. **Verdict** — a pan of diameter *d* holds `packing × π(d/2)²` of food area,
   where *packing* (default 70 %) accounts for the gaps irregular pieces leave.
   Every pan and every pair of pans is scored by rounds needed,
   `ceil(total / capacity)`, and ranked: fewest rounds, then fewest pans, then the
   smallest pan that does the job.

Pans, board size/shape, and the packing factor persist in `localStorage`.

## Accuracy and limitations

- Verified against synthetic images with mathematically exact perspective
  distortion: measured areas are within 0.5 % of ground truth for both rectangular
  and round boards.
- Real-world accuracy is dominated by photo quality: even lighting, food that
  contrasts with the board, and pieces that don't touch. Touching pieces merge into
  one blob, which is harmless for the total area the verdict uses.
- The verdict is area-based, not a packing layout; it says *whether* the food fits,
  not *how* to arrange it. A visual arrangement view is a possible future addition.

## License

[MIT](LICENSE)
